# Progreso — comparador-compras

Bitácora append-only de cada corrida autónoma. Lo más reciente arriba.

<!-- Formato de cada entrada:
## YYYY-MM-DD HH:MM
- Tarea: <descripción>
- Rama/PR: <rama o enlace al PR>
- Resultado: <fusionado | PR para revisión | bloqueado: motivo>
- Verificación: <comando corrido y resultado>
-->

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
