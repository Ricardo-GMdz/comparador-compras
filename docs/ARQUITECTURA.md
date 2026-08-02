# Arquitectura — comparador-compras

App web de **sourcing de proveedores B2B**: dada una búsqueda (producto/material
y región), un agente con `web_search`/`web_fetch` encuentra **proveedores**,
reúne sus **datos de contacto**, los acumula en un **directorio persistente** y
recomienda la **mejor opción** de compra.

> **Historia:** el proyecto nació como CLI de comparación de precios retail
> (v1). Ese CLI fue **archivado el 2026-08-02** (PR #20) — recuperable en el tag
> `legacy-cli-v1` — cuando quedó claro que el producto real es la app de
> sourcing. La cobertura de MercadoLibre vía adaptador OAuth se archivó con él
> (la API de búsqueda de ML está cerrada para apps generales; la cobertura de ML
> se logra vía `web_search`).

## Principios

- **Inmutabilidad**: ningún módulo muta objetos; siempre devuelve copias nuevas.
- **Errores explícitos**: se manejan en cada nivel; nunca se tragan en silencio.
  Validación en los límites (entrada del usuario, respuestas externas) con `zod`.
- **Archivos chicos y cohesivos**: 200-400 líneas típico, 800 máx.
- **Multi-región**: la región es un parámetro que condiciona moneda, tiendas y
  cercanía. No se hardcodea ningún país; el default es `"global"`.
- **Naming**: `camelCase` (vars/funcs, con `is/has/should/can` para booleanos),
  `PascalCase` (tipos/interfaces), `UPPER_SNAKE_CASE` (constantes). Identificadores
  en inglés; comentarios en español.
- **TDD**: test primero (rojo) → implementación mínima (verde) → refactor.
- **La telemetría nunca tumba el negocio**: instrumentación defensiva; un fallo
  de logging no puede perder una búsqueda ya respondida.

## Stack

- TypeScript + Node, ESM (`"type": "module"`), package manager `pnpm`.
- Tooling: `vitest` (tests), `eslint` + `prettier`, `tsconfig` strict, CI en
  GitHub Actions (lint + typecheck + test).
- SDK: `@anthropic-ai/sdk`, modelo `claude-opus-4-8`, adaptive thinking
  (+ `output_config.effort` cuando hay presupuesto); server tools
  `web_search_20260209` y `web_fetch_20260209`.
- Servidor **Hono**. Local: `@hono/node-server` sirve API + frontend estático
  (**HTML/CSS/JS vanilla**). Producción: **Vercel** (función serverless única).
- Persistencia: **Upstash Redis** en producción (`@upstash/redis`);
  `directorio.json` (gitignoreado) solo en dev local.
- Rate limiting: `@upstash/ratelimit` sobre el mismo Redis.
- Config de entorno con `zod`; carga de `.env` nativa (`process.loadEnvFile`).

## Los dos entries

|                         | Local (`src/server/index.ts`)                                               | Producción (`api/index.ts`, Vercel)                                                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store                   | `directorio.json` (`loadDirectory`/`saveDirectory`, escritura atómica)      | Redis Upstash (`createRedisStore`)                                                                                                                                                                         |
| Auth                    | sin auth                                                                    | `ACCESS_KEY` + cookie (`src/server/auth.ts`)                                                                                                                                                               |
| Rate limit              | no                                                                          | login 5/15 min por IP; buscar+enriquecer 10/h global                                                                                                                                                       |
| Presupuesto de búsqueda | sin recortes (defaults: 5 búsquedas, 16K tokens, 3 variantes, sin deadline) | `VERCEL_SEARCH_BUDGET`: 2 búsquedas, 8K tokens, effort low, 2 variantes, **timeout 45 s por llamada** (límite de 60 s del plan Hobby; sin deadline propio una llamada lenta muere en 504 sin catch ni log) |
| Frontend                | estáticos de `web/`                                                         | los mismos, servidos por Vercel; `landing/` pública                                                                                                                                                        |

La **lógica pura** de `directory/store.ts` (`supplierKey`, `mergeSuppliers`,
`directorySchema`) corre en **ambos** entries; lo que cambia es la persistencia
(archivo vs Redis).

## Flujo end-to-end (producción)

```
navegador  Buscar(producto/material, región)          [cookie de sesión]
  -> POST /api/buscar                                  [rate limit 10/h]
       -> zod: query ≤200 chars, region ≤60
       -> createSupplierSource(...).search()           (fan-out de variantes en
          paralelo; Claude + web_search; cada llamada pasa por callModel, que
          loguea llm_usage: tokens, server tools, costo estimado)
       -> parseSuppliers(...)                          (zod, defensivo por item)
       -> store.load() -> mergeSuppliers -> store.save()   (Redis)
       -> rankSuppliers / selectBestSupplier           (niveles + outliers)
  <- { ok, suppliers, mejorOpcion, encontrados, nuevos, total }
     (encontrados = hallados en ESTA búsqueda; el front los destaca en Inicio)
```

Errores del sourcing: **503** "servicio saturado, reintentá" para 429/5xx o
fallo de conexión del SDK; **502** con mensaje genérico para el resto. El
`error.message` crudo va **solo al logger**, nunca al cliente.

## Módulos y contratos

- `src/domain/supplier.ts` — `SupplierContact`, `SupplierCandidate` (lo que
  produce el sourcing) y `Supplier` (candidate + `firstSeen`/`lastSeen` +
  `status`/`notes`/`favorite`).
- `src/llm/` — capa de acceso al modelo:
  - `callModel.ts` — único wrapper sobre `messages.create`; en éxito emite
    `llm_usage` (tokens, caché, requests de server tools, costo estimado) con el
    contexto de negocio (`action`, query/supplier/...). Lectura defensiva de
    `usage`; en error propaga sin loguear usage (lo loguea el caller).
  - `pricing.ts` — estimación de costo: input/output a precios de
    `claude-opus-4-8` ($5/$25 por MTok), caché a 1,25× (escritura) y 0,1×
    (lectura), fee de `web_search` ($0,01/uso). Es aproximación, no factura.
  - `parse.ts` — `extractText` (bloques → texto) y `parseJsonObject` (tolera
    prosa/fences alrededor del JSON).
- `src/sourcing/supplierSource.ts` — `createSupplierSource({ client, localidad?,
searchBudget? })`:
  - `search()` — fan-out de variantes de query (`buildQueryVariants`, 3 por
    default) en paralelo con `Promise.allSettled`: una variante que falla no
    tumba a las demás; unión deduplicada por `supplierKey`. Contexto de
    telemetría: `sourcing_search`.
  - `enrichContact()` — visita la web del proveedor (`web_fetch` + `web_search`
    de respaldo) y devuelve SOLO campos de contacto faltantes. Respeta el
    `searchBudget` (`maxTokens`/`effort`). Contexto: `sourcing_enrich_contact`.
  - `SearchBudget` — `{ maxWebSearchUses, maxTokens, maxVariants?, effort?,
timeoutMs? }`. Con `timeoutMs`, cada llamada se corta al vencer (el SDK
    lanza `APIConnectionTimeoutError` y no reintenta): las variantes que sí
    terminaron se devuelven igual; si vencen todas, el server responde 503.
- `src/sourcing/supplierSchema.ts` — `parseSuppliers` (respuesta del modelo →
  `SupplierCandidate[]`, parseo defensivo por item).
- `src/directory/store.ts` — `supplierKey` (identidad por dominio del sitio, o
  nombre+región), `mergeSuppliers` (merge inmutable con timestamps),
  `loadDirectory`/`saveDirectory` (JSON local, escritura atómica).
- `src/directory/redisStore.ts` — `createRedisStore` (persistencia en Upstash
  para producción, mismo contrato de store).
- `src/directory/publicDirectory.ts` — proyección pública del directorio (lo que
  consume la landing; sin `favorite` ni campos internos).
- `src/ranking/rankSuppliers.ts` — `rankSuppliers` (orden) y `selectBestSupplier`
  (mejor por niveles; descarta outliers de precio; el MOQ es dato, no ordena).
- `src/quotes/quoteTemplate.ts` — `buildQuoteMessage` (mensaje de cotización en
  español, función pura).
- `src/server/auth.ts` — login por `ACCESS_KEY` (comparación timing-safe) y
  cookie de sesión.
- `src/server/api.ts` — `buildApi(deps)` → app Hono con deps inyectables
  (`store`, `source`, `auth?`, `rateLimit?`). El rate limit es **fail-open**: si
  Redis falla, el request se permite y se loguea (un Redis caído ya degrada la
  app; no debe además bloquear al dueño).
- `src/server/index.ts` — entry local. `api/index.ts` — entry Vercel
  (`maxDuration: 60`).
- `src/config/` — `env.ts` (`ANTHROPIC_API_KEY`, `SOURCING_LOCALIDAD?`),
  `vercelEnv.ts` (`ACCESS_KEY`, credenciales Upstash `KV_*`/`UPSTASH_*`),
  `loadDotenv.ts`.
- `scripts/` — `seed-redis.ts` (siembra el directorio local en Upstash),
  `repoblar.ts` (re-poblado: baja → busca → mergea → sube).
- `web/` — frontend vanilla (sidebar Inicio/Historial, tabla, modales, CSV).
- `landing/` — página pública con el directorio publicado.

### Rutas de la API

| Ruta                                  | Auth    | Notas                                       |
| ------------------------------------- | ------- | ------------------------------------------- |
| `POST /api/login`                     | —       | rate limit 5/15 min por IP                  |
| `GET /api/health`                     | pública | liveness                                    |
| `GET /api/publico`                    | pública | directorio publicado (landing)              |
| `GET /api/directorio`                 | cookie  | directorio + mejor opción                   |
| `GET /api/directorio.csv`             | cookie  | export CSV (12 columnas en español)         |
| `POST /api/buscar`                    | cookie  | sourcing + merge + ranking; rate limit 10/h |
| `PATCH /api/proveedor/:key`           | cookie  | `status` / `notes` / `favorite`             |
| `DELETE /api/proveedor/:key`          | cookie  | eliminar del directorio                     |
| `GET /api/proveedor/:key/cotizacion`  | cookie  | mensaje de cotización                       |
| `POST /api/proveedor/:key/enriquecer` | cookie  | completar contacto; rate limit 10/h         |
| `POST /api/publicar`                  | cookie  | publica el directorio a la landing          |

### Ranking del mejor proveedor (por niveles)

Primero se descartan outliers de precio de mayoreo. Luego, en orden:

1. confiable + en la región del usuario, más barato;
2. confiable (cualquier región), más barato;
3. en la región (aunque no verificado), más barato;
4. el más barato disponible.

### Directorio persistente

En producción la fuente de verdad es **Redis** (Upstash); `directorio.json` es
solo el store de dev local y el seed inicial. Cada búsqueda **agrega o
actualiza** proveedores por identidad (dominio del sitio; si falta,
nombre+región), conservando `firstSeen` y refrescando `lastSeen`. El contador
"N en total · +M nuevos" sale del merge.

## Historial de versiones (resumen)

- **v2.1** (2026-07) — gestión del directorio: estados
  (`pendiente`→`contactado`→`cotizó`/`descartado`), notas, modal de cotización,
  enriquecer contacto puntual, export CSV, ranking por unidad de precio
  dominante (`priceUnit`).
- **v2.2** (2026-07-12) — `catalogPrice` (precio de lista, distinto del mayoreo),
  `address`, modal de detalle, favoritos, orden y filtro. Deploy en **Vercel**
  con **Redis** y landing pública.
- **v2.3** (2026-07-13) — sidebar Inicio/Historial (navegación client-side pura),
  CSV resumido de 12 columnas, identidad visual **"Placa industrial"** (grafito +
  latón + verdigrís, IBM Plex, la mejor opción como placa estampada; todo por
  tokens CSS).
- **v2.4** (2026-07-18) — fan-out de 3 variantes de búsqueda en paralelo y regla
  de extracción a campos estructurados (precio/dirección nunca solo en `notes`).
- **Endurecimiento** (2026-08-02, PRs #17–#21 según `docs/PLAN-2026-07-29.md`) —
  costo acotado por búsqueda (fan-out ×2 en Vercel, budget en enrich, topes de
  entrada), rate limiting, errores sin fuga de detalle interno, CLI v1
  archivado (~3.900 líneas menos), y telemetría de uso/costo del LLM
  (`src/llm/`).

## Diagrama de dependencias (alto nivel)

```
web/ (vanilla)                    landing/ (pública)
  └─ fetch → server/api.ts (buildApi)
       ├─ server/auth.ts (ACCESS_KEY + cookie)          [solo prod]
       ├─ @upstash/ratelimit (login / costosos)         [solo prod]
       ├─ sourcing/supplierSource.ts (search / enrichContact)
       │    ├─ llm/callModel.ts ── llm/pricing.ts       (telemetría llm_usage)
       │    ├─ llm/parse.ts
       │    └─ sourcing/supplierSchema.ts + @anthropic-ai/sdk
       ├─ directory/store.ts (lógica pura: key/merge/schema)
       │    ├─ JSON local (dev)  |  redisStore.ts (prod)
       │    └─ publicDirectory.ts (proyección landing)
       └─ ranking/rankSuppliers.ts
  server/index.ts (entry local) | api/index.ts (entry Vercel, budget acotado)
  (transversal) domain/supplier.ts, config/, logging/logger.ts
```
