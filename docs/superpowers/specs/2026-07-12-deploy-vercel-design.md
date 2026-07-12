# Diseño — Deploy funcional a Vercel

Fecha: 2026-07-12
Estado: aprobado (brainstorming)

## Propósito

Hoy la app funcional de sourcing (v2.1) corre solo en `localhost:8787`; lo único
público es la landing informativa de GitHub Pages. El objetivo es tener la
**app funcional en una URL pública** (buscar, gestionar el directorio, cotizar),
usable por Ricardo y 1–2 socios, protegida con una clave de acceso compartida
— porque cada búsqueda gasta tokens de la cuenta de Anthropic del dueño.

Decisiones tomadas en el brainstorming:

- Hosting: **Vercel plan Hobby (gratis)**. El usuario aún no tiene cuenta; la
  crea él mismo cuando llegue el deploy (nunca creamos cuentas por él) y después
  el deploy sigue por CLI con token.
- Acceso: **una clave compartida** (Ricardo + 1–2 socios de confianza).
- Persistencia: **Upstash Redis** (marketplace de Vercel).
- Base pública: la landing de GitHub Pages **lee de Vercel** (endpoint público);
  "Publicar" deja de escribir archivos/commitear.
- **Búsqueda acotada:** el plan Hobby mata cualquier request (y su trabajo en
  background) a los **60 s**, y una búsqueda es una sola llamada al agente que
  hoy tarda 1–4 min y no se puede partir. Decisión explícita: en el deploy la
  búsqueda corre en **modo acotado** (menos rondas de `web_search`, presupuesto
  de "pensar" reducido, menos resultados) para caber en 60 s, **aceptando que
  encuentra menos y con menos detalle** que el modo local sin límite. El modo
  local (`pnpm run serve`) queda **sin recortes**.

## Arquitectura

**Dos formas de correr, mismo código.** La lógica no se toca; solo cambian las
dependencias inyectadas en `buildApi(deps)`:

- **Local (intacto):** `src/server/index.ts` — filesystem (`directorio.json`),
  sin clave, estáticos de `web/` con `@hono/node-server`. Sigue siendo el flujo
  de desarrollo.
- **Vercel (nuevo):** `api/index.ts` con el adapter `hono/vercel` — Redis como
  store, middleware de clave de acceso, `maxDuration = 300`. Los estáticos de
  `web/` los sirve Vercel directamente (configuración en `vercel.json`).

## Componentes

### 1. Store en Redis — `src/directory/redisStore.ts`

Implementa el mismo contrato que el store de archivo (mismas firmas que
`loadDirectory`/`saveDirectory` de `src/directory/store.ts`):

- `load`: GET de la clave `directorio` → parse JSON → **misma validación zod**
  que el store de archivo (el schema se exporta/reusa, no se duplica). Clave
  inexistente → `[]`. Contenido corrupto → error explícito (nunca se traga).
- `save`: SET de la clave `directorio` con el JSON completo. El SET de Redis es
  atómico; no hace falta el patrón tmp+rename del filesystem.
- El directorio público va bajo la clave `directorio-publico` (mismo módulo).
- Cliente: `@upstash/redis` (REST, compatible con serverless). Credenciales por
  env: `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`.
- El cliente se inyecta (interfaz mínima `get`/`set`) para testear con mock.

### 2. Clave de acceso — middleware Hono + pantalla de entrada

- `ACCESS_KEY` (env de Vercel) es la clave compartida que define el usuario.
- `POST /api/login` con `{ key }`: si coincide (comparación en **tiempo
  constante**, `crypto.timingSafeEqual`) setea cookie `HttpOnly` + `Secure` +
  `SameSite=Lax`, firmada (HMAC con `ACCESS_KEY` como secreto), válida 30 días.
- Middleware: toda ruta exige cookie válida, **excepto** `POST /api/login`,
  `GET /api/publico` y los estáticos de la pantalla de login.
- Sin cookie: la API responde `401 { ok: false, error }`; el frontend detecta el
  401 y muestra la pantalla de entrada (un solo campo de clave).
- Sin usuarios, sin registro, sin rate limiting propio (confianza entre 2–3
  personas; YAGNI).
- El middleware se activa solo en el entry de Vercel; el server local queda sin
  clave.

### 3. Base pública — `GET /api/publico` + landing

- "Publicar" (`POST /api/publicar`, ya existente) pasa a guardar la selección
  pública en Redis (`directorio-publico`) vía la dependencia
  `savePublicDirectory` inyectada — el filtrado (`buildPublicDirectory`: solo
  contactados/cotizó, sin notas ni timestamps) no cambia.
- `GET /api/publico` (nuevo, sin clave): devuelve esa selección con
  `Access-Control-Allow-Origin: *` (dato deliberadamente público).
- La landing de GitHub Pages cambia el fetch de `./proveedores.json` a la URL
  del deploy (`https://<app>.vercel.app/api/publico`), con la URL en una
  constante al tope de `landing/index.html`. Fallback: si el fetch falla, la
  sección queda oculta (comportamiento actual).
- `landing/proveedores.json` y el flujo de commitear/pushear ese archivo quedan
  obsoletos (se documenta; el archivo se elimina si existe).

### 4. Búsqueda acotada — presupuesto inyectable en el sourcing

`createSupplierSource` gana un parámetro opcional `searchBudget` en
`SupplierSourceDeps` que sobreescribe las constantes que hoy son fijas:

- `maxWebSearchUses` (hoy 5) — cuántas rondas de `web_search` permite el agente.
- `thinking` (hoy `adaptive`) — pasa a un presupuesto acotado (`type: "enabled",
budget_tokens: N`) o se desactiva, para no gastar minutos "pensando".
- `maxEmptyRetries` (hoy 1) — en modo acotado baja a 0 (un reintento duplica el
  tiempo).
- `maxTokens` (hoy 16000) — tope de salida más chico.

Sin `searchBudget` el comportamiento es **idéntico al actual** (local sin
recortes). El entry de Vercel pasa un `searchBudget` conservador (p. ej.
`maxWebSearchUses: 2`, thinking acotado, `maxEmptyRetries: 0`) elegido para que
el turno del agente cierre dentro de los 60 s. Los valores exactos se afinan en
implementación midiendo una búsqueda real; se documentan como constantes.

### 5. Entry de Vercel — `api/index.ts` + `vercel.json`

- `api/index.ts`: carga env (zod — `ANTHROPIC_API_KEY`, `ACCESS_KEY`, Upstash,
  `SOURCING_LOCALIDAD` opcional), arma cliente Anthropic + Redis, y exporta el
  handler de `hono/vercel` con `buildApi(...)` + middleware de clave y el
  `searchBudget` acotado.
- `vercel.json`: estáticos de `web/` en la raíz, rewrites de `/api/*` a la
  función, `maxDuration: 60` (tope del plan Hobby).
- La UI marca la búsqueda en curso y, si el request se corta por timeout,
  muestra un error claro ("la búsqueda tardó demasiado, probá de nuevo") en vez
  de colgarse.
- Siembra inicial: script one-shot (`scripts/seed-redis.ts`) que sube el
  `directorio.json` local (29 proveedores) a Redis. Se corre una vez tras el
  primer deploy.

## Flujo end-to-end (Vercel)

```
socio → https://<app>.vercel.app
  sin cookie → pantalla de clave → POST /api/login → cookie 30 días
  con cookie → app completa: buscar / gestionar / cotizar / publicar
                (store = Redis; sourcing = Claude + web_search, igual que local)

visitante → landing GitHub Pages
  fetch https://<app>.vercel.app/api/publico → tabla de contactos públicos
```

## Riesgos y límites conocidos

- **Timeout / calidad recortada (el trade-off central):** el plan Hobby corta
  todo request a 60 s y no hay cómputo durable en background, así que la
  búsqueda corre en modo acotado (componente 4). Esto **reduce cuántos
  proveedores encuentra y con cuánto detalle** frente al modo local sin límite.
  Aun acotada, una búsqueda podría pasarse de 60 s y cortarse (la UI avisa y se
  reintenta). Es una decisión consciente de priorizar "gratis" sobre "máxima
  cobertura". Salidas si molesta: correr en local para búsquedas a fondo, o
  migrar a un server siempre-prendido (Railway/Fly) — fuera de alcance ahora.
- **Concurrencia:** dos socios guardando a la vez pueden pisarse (last write
  wins sobre el JSON completo). Aceptado para 2–3 usuarios de confianza; si
  duele, se migra a operaciones por proveedor.
- **Costo de tokens:** la clave compartida es la única barrera; quien la tenga
  gasta tokens del dueño. Aceptado (círculo de confianza).

## Testing (TDD)

- **Middleware de auth:** sin cookie → 401; clave incorrecta en login →
  rechazo; login correcto → cookie y acceso; cookie adulterada → 401;
  `/api/publico` y `/api/login` pasan sin cookie.
- **redisStore** (cliente mockeado): round-trip load/save; clave inexistente →
  `[]`; JSON corrupto → error explícito; directorio público round-trip.
- **Búsqueda acotada** (cliente Anthropic mockeado): con `searchBudget` se
  pasan `max_uses`/`thinking`/reintentos acotados al request; **sin**
  `searchBudget` el request queda idéntico al actual (no rompe el modo local).
- **`GET /api/publico`:** responde sin clave, con header CORS, solo campos
  públicos (sin notas).
- El smoke E2E existente sigue cubriendo el server local sin cambios.

## Criterios de éxito

- URL pública de Vercel donde, con la clave, se puede buscar un producto real y
  gestionar el directorio desde cualquier dispositivo.
- El directorio sobrevive entre requests y deploys (Redis), sembrado con los
  proveedores existentes.
- Sin clave: solo se ve la pantalla de entrada y el endpoint público.
- La landing de GitHub Pages muestra la base pública leyendo de Vercel;
  "Publicar" es instantáneo.
- El flujo local (`pnpm run serve`) sigue funcionando exactamente igual.
