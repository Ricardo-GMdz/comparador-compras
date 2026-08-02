# Backlog — comparador-compras

Tareas priorizadas (orden = prioridad; la de más arriba se trabaja primero).
Cada tarea lleva etiqueta `[auto]` o `[review]`:

- `[auto]` = bajo riesgo; el sistema puede fusionar solo si los checks pasan.
- `[review]` = el sistema deja PR para revisión humana, no fusiona.

Al terminar, la tarea se marca `[x]` y se mueve a "Hechas".

## Pendientes

- [ ] [auto] Verificar en los logs de producción que `llm_usage` aparece con
      costos plausibles tras las primeras búsquedas reales (cierre del plan de
      prueba de #21). Nota 2026-08-02: verificada la emisión con búsqueda real
      por el path compilado (costo cuadró al centavo: $0,2449); en prod quedó
      bloqueada por el 504 → destrabada por el fix de timeout; falta solo
      re-mirar los logs de Vercel con la API a latencia normal
- [ ] [auto] Atar la tabla de precios de `src/llm/pricing.ts` a la constante
      `MODEL`: hoy los precios son de `claude-opus-4-8` hardcodeados y un cambio
      de modelo dejaría la estimación silenciosamente inválida (riesgo conocido
      documentado en #21)
- [ ] [review] Contador diario de gasto (`INCR` en Redis) + `GET /api/uso`
      autenticado — parte del PR-E planificado en `docs/PLAN-2026-07-29.md` que
      no se envió; hoy la telemetría vive solo en logs
- [ ] [review] Fase 3 del plan (optimización de modelo, GATED: recién tras 1–2
      semanas de telemetría en producción): `claude-opus-5` drop-in → structured
      outputs → Sonnet 5 en el fan-out (`SEARCH_MODEL` separada) → Haiku/Sonnet
      en enrich. El "timeout propio con degradación parcial" ya salió de esta
      fase: se adelantó el 2026-08-02 porque producción daba 504 (la latencia
      real de web_search+Opus medida fue de minutos, no los ~15-40 s estimados).
      Orden y detalles en `docs/PLAN-2026-07-29.md` §Fase 3
- [ ] [review] Fase 4 del plan (tests de la ruta real): coverage ejecutable
      (`@vitest/coverage-v8` o borrar la config muerta), test del entry
      `api/index.ts` (armado de deps extraído a función), smoke E2E con el
      `fakeRedis` de `redisStore.test.ts`, Playwright mínimo
      (login → buscar → patch)
- [ ] [auto] Revisar unidad de precio con datos reales (¿el sourcing devuelve
      `priceUnit` consistente? ajustar normalización si aparecen variantes)
- [ ] [review] SQLite si el directorio escala (hoy Redis en prod y JSON local
      alcanzan)
- [ ] [review] Retomar cobertura por API de MercadoLibre si ML abre la API de
      búsqueda (el adaptador `mercadoLibreSource` fue archivado con el CLI v1;
      recuperable en el tag `legacy-cli-v1`)

## Recurrentes (monitoreo — NO se marcan hechas; cada corrida se registra en PROGRESO.md y solo se avisa si algo está mal)

<!-- Tareas de solo-reporte (ej. [navegador] revisar un dashboard). No generan
     cambios de código, rama ni merge. Si una necesita login sin sesión guardada,
     se omite y se marca "necesita login supervisado". -->

## Hechas

<!-- el sistema mueve aquí las tareas completadas, con fecha -->

- [x] 2026-08-02 — serie de endurecimiento completa (Fases 1–2 de
      `docs/PLAN-2026-07-29.md`) mergeada y verificada: #17 costo acotado
      (fan-out ×2 en Vercel, budget en enrich, topes de entrada), #18 rate
      limiting (login 5/15min por IP, costosos 10/h), #19 errores sin fuga de
      `error.message`, #20 CLI v1 archivado (tag `legacy-cli-v1`, −3.900
      líneas), #21 telemetría de uso/costo del LLM (`src/llm/`); docs
      actualizados a la realidad (PR-F)
- [x] 2026-07-18 — v2.4: fan-out de 3 variantes + extracción a campos
      estructurados (`feat/v2.4-fanout-extraccion`, #16)
- [x] 2026-07-13 — v2.3: sidebar Inicio/Historial, CSV resumido, identidad
      "Placa industrial" (#8–#11)
- [x] 2026-07-12 — v2.2 + producción: catalogPrice/address/detalle/favoritos,
      deploy Vercel + Upstash Redis, landing pública, auth por ACCESS_KEY
      (#2–#7)
- [x] 2026-07-05 — v2.1: gestión del directorio (estado/notas/borrar/filtrar),
      modal de cotización con template local, ranking por unidad de precio
      dominante, enriquecer contacto por proveedor, export CSV, smoke E2E
      (`feat/v2.1-mejoras`)
- [x] 2026-07-04 — v2: app web de sourcing de proveedores — agente `web_search`
      B2B, directorio persistente, ranking por niveles, API Hono + frontend
      vanilla (`feat/supplier-sourcing`, fusionada)
- [x] 2026-07-01 — features v1: upgrade por variante, condición, outliers, dedup
      multi-fuente, fuente MercadoLibre opt-in + review adversarial con 5 fixes
      (`feat/upgrade-suggestion`, fusionada)
- [x] 2026-06-30 — scaffold CLI comparador + primer slice v1 (Claude +
      `web_search`, zod, comparación básica) (`scaffold/cli-comparador`,
      fusionada)
