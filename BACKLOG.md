# Backlog — comparador-compras

Tareas priorizadas (orden = prioridad; la de más arriba se trabaja primero).
Cada tarea lleva etiqueta `[auto]` o `[review]`:

- `[auto]` = bajo riesgo; el sistema puede fusionar solo si los checks pasan.
- `[review]` = el sistema deja PR para revisión humana, no fusiona.

Al terminar, la tarea se marca `[x]` y se mueve a "Hechas".

## Pendientes

- [ ] [review] Playwright E2E si la app crece (hoy alcanza el smoke E2E de la API)
- [ ] [review] SQLite si el directorio escala (hoy `directorio.json` alcanza)
- [ ] [auto] Revisar unidad de precio con datos reales (¿el sourcing devuelve
      `priceUnit` consistente? ajustar normalización si aparecen variantes)
- [ ] [review] Reactivar `mercadoLibreSource` si ML abre la API de búsqueda

## Recurrentes (monitoreo — NO se marcan hechas; cada corrida se registra en PROGRESO.md y solo se avisa si algo está mal)

<!-- Tareas de solo-reporte (ej. [navegador] revisar un dashboard). No generan
     cambios de código, rama ni merge. Si una necesita login sin sesión guardada,
     se omite y se marca "necesita login supervisado". -->

## Hechas

<!-- el sistema mueve aquí las tareas completadas, con fecha -->

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
