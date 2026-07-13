# Arquitectura — comparador-compras

El proyecto tiene dos capacidades:

- **v2 — Sourcing de proveedores (foco actual):** app web local que, dada una
  búsqueda (producto/material + región), encuentra **proveedores B2B**, reúne sus
  **datos de contacto**, los acumula en un **directorio persistente** y recomienda
  la **mejor opción**. En implementación según
  `docs/superpowers/plans/2026-07-01-sourcing-proveedores.md`.
- **v1 — Comparación de retail (motor de fondo, reusado):** CLI que compara
  **ofertas de retail** de un producto (mejor opción, upgrade por variante,
  condición nuevo/reacondicionado, outliers, dedup multi-fuente). Su motor
  (cliente Claude + `web_search`, parseo defensivo con zod, ranking, outliers) se
  reusa en el v2.

> Nota externa: la API de búsqueda de MercadoLibre está **cerrada** para apps
> generales (403 aun con token OAuth válido). La cobertura de ML se logra vía
> `web_search`. Existe un adaptador `mercadoLibreSource` opt-in deshabilitado.

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

## Stack

- TypeScript + Node, ESM (`"type": "module"`), package manager `pnpm`.
- Tooling: `vitest` (tests), `eslint` + `prettier`, `tsconfig` strict, CI en
  GitHub Actions (lint + typecheck + test).
- SDK: `@anthropic-ai/sdk`, modelo `claude-opus-4-8`, adaptive thinking; server
  tool `web_search` (`"web_search_20260209"`).
- Config de entorno con `zod` (`ANTHROPIC_API_KEY`); carga de `.env` nativa
  (`process.loadEnvFile`).
- **v2:** servidor **Hono** (+ `@hono/node-server`) sirve la API JSON y el
  frontend estático (**HTML/CSS/JS vanilla**). Store en **`directorio.json`**
  (gitignoreado). **v1:** CLI con `commander`.

## v2 — Sourcing de proveedores

### v2.1 — gestión del directorio y cotización

Sobre la base del v2, la v2.1 convierte el directorio en herramienta de trabajo:
cada proveedor tiene **estado** (`pendiente` → `contactado` → `cotizó` /
`descartado`) y **notas** editables desde la tabla; los `descartado` siguen
visibles pero **nunca** compiten como mejor opción. El sourcing extrae la
**unidad del precio** (`priceUnit`: pieza/kg/tonelada/m2) y el ranking solo
compara precios dentro de la **unidad dominante** (espejo de `dominantCurrency`
del v1). Un modal de **cotización** genera un mensaje copiable (template local
`buildQuoteMessage`, con link directo a WhatsApp si hay número), el botón
**Completar** enriquece el contacto de un proveedor puntual (agente con
`web_fetch` sobre su sitio, solo campos faltantes) y el directorio se exporta a
**CSV**. Los proveedores persistidos sin `status` migran a `"pendiente"` al leer.

### v2.2 — análisis, detalle y favoritos

El sourcing extrae dos datos más cuando el proveedor los publica: **precio de
catálogo** (`catalogPrice`, precio de lista/unitario, distinto del `wholesalePrice`
de mayoreo — resuelve el caso de instrumentos que no publican mayoreo) y
**dirección** (`address`, ciudad/domicilio). Clickear el **nombre** de un proveedor
abre un **modal de detalle** con todo (precios mayoreo/catálogo, MOQ, stock,
dirección, contacto, notas, y "Envío: se consulta en la cotización" — el envío no
se auto-completa). Cada proveedor puede marcarse como **favorito** (`favorite`,
gestión manual como `status`/`notes`: el sourcing no lo pisa y **nunca** se publica
en la landing). La barra suma **orden** (precio efectivo = mayoreo ?? catálogo /
favoritos / nombre / reciente) y filtro **"solo favoritos"** (client-side). El CSV
suma `catalogPrice`, `address`, `favorite`; el directorio público suma
`catalogPrice`/`address` (no `favorite`).

### v2.3 — navegación con sidebar y CSV resumido

**Identidad visual — "Placa industrial"** (`web/styles.css`): sistema de diseño
deliberado para una cabina de compras B2B. Rail de **grafito** (`#1a1d21`) +
superficie **papel**, acento **latón** (`#b8862b`) para precios/CTA, **verdigrís**
(`#3f7a6d`) para "confiable"/stock y **óxido** para descartado/error. Tipografía
**IBM Plex Sans** (UI) + **IBM Plex Mono** (datos, etiquetas y precios en
numerales tabulares, como lectura de instrumento). Firma: la **mejor opción** se
muestra como una **placa estampada** (eyebrow mono, sello verdigrís "✓ Confiable",
precio grande en latón). Todo el color y la tipografía se derivan de tokens CSS.

El frontend se reorganiza con un **sidebar**: **Inicio** (el buscador, los
resultados de la última búsqueda y un vistazo a los favoritos) e **Historial**
(el directorio completo con
filtro/orden/estados/acciones/CSV/Publicar). Es navegación client-side pura
(`mostrarVista` togglea `#vista-inicio`/`#vista-historial`, sin router); el
estado en memoria se comparte y la sección de favoritos reusa `renderTable`
(parametrizada por contenedor) con los mismos handlers de fila. El **CSV** pasa a
un resumen legible en español de 12 columnas (Proveedor, Sitio web, Material,
Región, **Precio** [efectivo: mayoreo ?? catálogo], **Moneda**, Email, WhatsApp,
Teléfono, **Dirección**, Estado, Favorito); se quitan las columnas internas
(priceUnit, moq, formUrl, trusted, notes, timestamps).

### Flujo end-to-end

```
navegador  Buscar(producto/material, región)
  -> POST /api/buscar
       -> createSupplierSource(...).search({ query, region })   (Claude + web_search)
       -> parseSuppliers(...)                                    (zod, defensivo)
       -> loadDirectory(directorio.json)
       -> mergeSuppliers(existentes, nuevos, now)                (merge por identidad)
       -> saveDirectory(...)                                     (escritura atómica)
       -> rankSuppliers / selectBestSupplier                     (niveles + outliers)
  <- { suppliers, mejorOpcion, nuevos, total }
navegador  <- pinta mejor opción destacada + tabla del directorio
```

### Módulos y contratos (v2)

- `src/domain/supplier.ts` — `SupplierContact`, `SupplierCandidate` (lo que produce
  el sourcing) y `Supplier` (candidate + `firstSeen`/`lastSeen`).
- `src/directory/store.ts` — `supplierKey` (identidad por dominio del sitio, o
  nombre+región), `mergeSuppliers` (merge inmutable con timestamps), `loadDirectory`
  / `saveDirectory` (persistencia JSON validada con zod, escritura atómica).
- `src/sourcing/supplierSchema.ts` — `parseSuppliers` (respuesta del modelo →
  `SupplierCandidate[]`, parseo defensivo por item).
- `src/sourcing/supplierSource.ts` — `createSupplierSource({ client })` (agente
  `web_search` orientado a proveedores B2B + extracción de contacto).
- `src/ranking/rankSuppliers.ts` — `rankSuppliers` (orden) y `selectBestSupplier`
  (mejor por niveles: confiable + región + menor precio de mayoreo; descarta
  outliers). El MOQ es dato, no ordena.
- `src/quotes/quoteTemplate.ts` — `buildQuoteMessage` (mensaje de pedido de
  cotización en español, función pura).
- `src/server/api.ts` — `buildApi(deps)` → app Hono (dependencias inyectables
  para test) con:
  - `POST /api/buscar` — sourcing + merge + ranking;
  - `GET /api/directorio` — directorio completo + mejor opción;
  - `GET /api/directorio.csv` — export CSV del directorio;
  - `PATCH /api/proveedor/:key` — actualizar `status` / `notes`;
  - `DELETE /api/proveedor/:key` — eliminar del directorio;
  - `GET /api/proveedor/:key/cotizacion?quantity=..&spec=..` — mensaje de
    cotización generado con `buildQuoteMessage`;
  - `POST /api/proveedor/:key/enriquecer` — completar contacto vía
    `enrichContact` (solo campos faltantes; lo existente gana).
- `src/server/index.ts` — entry: arma dependencias reales (cliente Anthropic desde
  env, funciones de store) y sirve API + estáticos de `web/`.
- `web/` — `index.html`, `styles.css`, `app.js` (la interfaz aprobada, vanilla).

### Ranking del mejor proveedor (por niveles)

Primero se descartan outliers de precio de mayoreo. Luego, en orden:

1. confiable + en la región del usuario, más barato;
2. confiable (cualquier región), más barato;
3. en la región (aunque no verificado), más barato;
4. el más barato disponible.

### Directorio persistente

`directorio.json` es la fuente de verdad. Cada búsqueda **agrega o actualiza**
proveedores por identidad (dominio del sitio; si falta, nombre+región), conservando
`firstSeen` y refrescando `lastSeen`. El contador "N en total · +M nuevos" sale del
merge.

## v1 — Motor de retail (reusado, de fondo)

CLI `comparar "<producto>" --region <code>`. Módulos existentes que se reusan o
quedan intactos:

- `domain/types.ts` (`Offer`, `Provider`, `Product`, `ComparisonResult`).
- `config/env.ts` (`loadEnv`), `config/loadDotenv.ts`, `logging/logger.ts`.
- `sources/webSearchSource.ts` (patrón de cliente Claude + `web_search`),
  `sources/mercadoLibreSource.ts` (opt-in deshabilitado).
- `compare/index.ts` (`normalizePrice`, `rankOffers`, `compareOffers`: mejor
  opción, upgrade por `tierRank`, condición, outliers).
- `agent/runner.ts` (`runComparison`) + `agent/dedupe.ts` (dedup multi-fuente).
- `cli/index.ts` (`buildProgram`) + `index.ts` (bin).

El logger separa salidas: el **resultado va a stdout**, los **logs a stderr**.

## Diagrama de dependencias (v2, alto nivel)

```
web/ (index.html, styles.css, app.js)
  └─ fetch → server/api.ts (buildApi)
       ├─ sourcing/supplierSource.ts (createSupplierSource)
       │    └─ sourcing/supplierSchema.ts (parseSuppliers) + @anthropic-ai/sdk
       ├─ directory/store.ts (load/merge/save)
       └─ ranking/rankSuppliers.ts (rankSuppliers, selectBestSupplier)
  server/index.ts (entry) → serve(api) + estáticos web/
  (transversal) domain/supplier.ts, config/env.ts, logging/logger.ts
```
