# Progreso — comparador-compras

Bitácora append-only de cada corrida autónoma. Lo más reciente arriba.

<!-- Formato de cada entrada:
## YYYY-MM-DD HH:MM
- Tarea: <descripción>
- Rama/PR: <rama o enlace al PR>
- Resultado: <fusionado | PR para revisión | bloqueado: motivo>
- Verificación: <comando corrido y resultado>
-->

## 2026-08-02 19:15

- Tarea: verificación de `llm_usage` con búsqueda real → encontró producción
  rota (POST /api/buscar → 504 FUNCTION_INVOCATION_TIMEOUT, 2/2 intentos; la
  función muere a los 60 s sin catch, log ni telemetría). Telemetría verificada
  OK por el path compilado con presupuesto de prod (evento real: 39.826 in /
  1.031 out / 2 búsquedas / $0,2449 — aritmética exacta). Causa estructural:
  una variante de web_search+Opus tardó >3 min (status de Anthropic operativo).
  Fix: `timeoutMs` en `SearchBudget` → `callModel` pasa `timeout` + `maxRetries: 0`
  al SDK; Vercel a 45 s/llamada; degradación parcial ya provista por
  `Promise.allSettled`; todas vencidas → 503 con log. E2E real del fix: corte
  exacto a 45,0 s, `APIConnectionTimeoutError`, 2 warns de variante — cabe en 60 s.
- Rama/PR: `fix/timeout-llm-degradacion-parcial`
- Resultado: PR para revisión
- Verificación: typecheck + lint + 211/211 tests en verde (TDD: 3 tests RED
  primero); E2E con búsqueda real contra la API

## 2026-08-02 17:30

- Tarea: merge y verificación de la serie de endurecimiento completa (Fases 1–2
  de `docs/PLAN-2026-07-29.md`), en orden #20 → #19 → #17 → #18 → #21 con rebase
  y verificación local por PR. Conflictos resueltos: api.ts (#18 vs #19,
  conservar ambas funciones), enrichContact (#21 vs #17, wrapper callModel CON
  el budget de #17), webSearchSource (#21 vs #20, aceptar el borrado — la
  telemetría de offers_search murió con el CLI). Después: actualización de toda
  la documentación a la realidad post-hardening (este commit).
- Rama/PR: PRs #17, #18, #19, #20, #21 (squash) + `docs/realidad-post-hardening`
- Resultado: fusionado a `main` (los cinco); 0 PRs abiertos
- Verificación: `pnpm run typecheck && pnpm run lint && pnpm vitest run` en
  verde por cada PR rebasado y sobre `main` final (206/206 tests); CI de `main`
  en verde

## 2026-07-29 → 2026-08-02

- Tarea: análisis multi-agente del repo (10 agentes) → `docs/PLAN-2026-07-29.md`
  (diagnóstico de costos y riesgos + plan por fases) y creación de la serie de
  endurecimiento: PR-A acotar costo (#17), PR-B rate limiting (#18), PR-C
  errores sin fuga (#19), PR-D archivar CLI v1 con tag `legacy-cli-v1` (#20),
  PR-E telemetría de uso/costo del LLM en `src/llm/` (#21, incluye fix de
  subestimación por tokens de caché y tests de integración por call site).
- Rama/PR: `fix/pr-a-acotar-costo`, `feat/pr-b-rate-limiting`,
  `fix/pr-c-errores-sin-fuga`, `chore/pr-d-archivar-cli-v1`,
  `refactor/pr-e-llm-usage-telemetry`
- Resultado: PRs para revisión (fusionados el 2026-08-02, ver entrada anterior)
- Verificación: typecheck + lint + tests en verde en cada rama al crearla

## 2026-07-13 → 2026-07-18

- Tarea: v2.3 — sidebar Inicio/Historial + CSV resumido (12 columnas) e
  identidad visual "Placa industrial" (grafito/latón/verdigrís, IBM Plex,
  tokens CSS); fixes de front (densidad, tabla sin scroll, labels); fix de
  producción `thinking: adaptive` + `output_config.effort` (Opus 4.8 no soporta
  thinking enabled con budget); `GET /api/health` público; script
  `scripts/repoblar.ts`; v2.4 — fan-out de 3 variantes de búsqueda en paralelo
  más extracción a campos estructurados (precio/dirección nunca solo en notes).
- Rama/PR: PRs #8–#16 (v2.3, rediseño, fixes, #13 thinking, #14 health,
  #15 repoblar, #16 v2.4)
- Resultado: fusionado a `main`
- Verificación: typecheck + lint + tests en verde por PR; CI en verde

## 2026-07-11 → 2026-07-12

- Tarea: v2.1 fusionada (#1) y salto a producción: landing pública, base de
  contactos, criterios de sourcing, fix de merge/mejor opción, deploy en
  **Vercel** (entry `api/index.ts`, función única con `maxDuration` 60 s,
  budget de búsqueda acotado) con **Upstash Redis** como store de producción
  (`createRedisStore`), auth por `ACCESS_KEY` + cookie, y v2.2 (catalogPrice,
  address, modal de detalle, favoritos).
- Rama/PR: PRs #1–#7 (`feat/v2.1-mejoras`, `feat/landing`,
  `feat/base-contactos`, `feat/criterios-sourcing`, `fix/merge-y-mejor-opcion`,
  `feat/deploy-vercel`, `feat/v2.2-analisis-detalle`)
- Resultado: fusionado a `main`; app corriendo en producción
- Verificación: typecheck + lint + tests en verde por PR; smoke manual en
  producción

## 2026-07-05 13:20

- Tarea: v2.1 — gestión del directorio (estado/notas/borrar/filtrar), pedido de
  cotización copiable (template local + modal), unidad de precio en el ranking
  (unidad dominante), enriquecimiento manual de contactos (`web_fetch`) y export
  CSV. Smoke E2E del server real.
- Rama/PR: `feat/v2.1-mejoras` (local; sin push — requiere confirmación humana)
- Resultado: PR para revisión
- Verificación: `pnpm run typecheck && pnpm run lint && pnpm test` en verde
  (incluye smoke E2E que levanta el server real en puerto efímero)

## 2026-07-04 17:09

- Tarea: v2 — app web de sourcing de proveedores: agente `web_search` B2B con
  extracción de contacto, directorio persistente (`directorio.json`, merge por
  identidad), ranking por niveles con outliers, API Hono (`/api/buscar`,
  `/api/directorio`) y frontend vanilla. Fix XSS (escape de HTML en el front).
- Rama/PR: `feat/supplier-sourcing` (trabajo del 2026-07-01 al 2026-07-04)
- Resultado: fusionado a `main`
- Verificación: `pnpm run typecheck && pnpm run lint && pnpm test` en verde;
  prueba manual del server (`node dist/server/index.js`) con búsqueda real

## 2026-07-01 00:21

- Tarea: features v1 sobre el CLI: upgrade por señal de variante, condición
  (nuevo/reacondicionado/usado), exclusión de outliers de precio, dedup
  multi-fuente, fuente MercadoLibre (OAuth, opt-in) y `web_search` con cobertura
  de marketplaces de la región. Review adversarial de la rama: 5 bugs corregidos.
- Rama/PR: `feat/upgrade-suggestion` (trabajo del 2026-06-30 al 2026-07-01)
- Resultado: fusionado a `main`
- Verificación: `pnpm run typecheck && pnpm run lint && pnpm test` en verde tras
  cada feature y tras los fixes de review

## 2026-06-30 11:09

- Tarea: scaffold del CLI agente comparador-compras + primer slice v1 (cliente
  Claude + `web_search`, parseo defensivo con zod, comparación básica); carga
  nativa de `.env`; separación de salidas (resultado a stdout, logs a stderr).
- Rama/PR: `scaffold/cli-comparador`
- Resultado: fusionado a `main`
- Verificación: `pnpm run typecheck && pnpm run lint && pnpm test` en verde;
  corrida manual del CLI con producto real
