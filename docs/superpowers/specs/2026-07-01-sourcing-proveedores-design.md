# Diseño — comparador-compras v2: sourcing de proveedores

Fecha: 2026-07-01
Estado: aprobado (brainstorming) — pendiente de plan de implementación

## Propósito

Reorientar el proyecto de una comparación de ofertas de **retail** hacia el
**sourcing de proveedores B2B**: dado algo que el usuario quiere comprar para
revender (ej. "láminas de metal galvanizadas"), encontrar **proveedores**
(páginas/empresas que funcionan como fuente de suministro), **reunir sus datos
de contacto**, ir **armando un directorio persistente**, y **recomendar la mejor
opción**.

Esto reconecta con la idea original del proyecto (NOTAS.md: "validar proveedores
a quienes puedo contactar"), que se había acotado a comparación de retail.

## Alcance

**Dentro:**

- App web local: buscar desde el navegador, ver el directorio.
- Agente de sourcing que encuentra proveedores y extrae su contacto.
- Directorio persistente (archivo JSON) que crece/actualiza entre búsquedas.
- Ranking del "mejor proveedor".

**Fuera (por ahora):**

- Que el agente **envíe** mensajes/emails (solo reúne datos de contacto).
- El MOQ como factor de ranking (se muestra como dato, no ordena).
- SQLite / base de datos (usamos JSON; se puede migrar después).
- React / frameworks de frontend (vanilla).

## Forma del producto

**App web local** (TS/Node). El usuario busca en el navegador (la barra de
búsqueda de la maqueta aprobada); el backend corre el agente de sourcing, guarda
los proveedores en el directorio y la UI los muestra (mejor opción + tabla).

El **CLI de retail** que ya construimos queda **de fondo**: se reusa su motor
(cliente Claude + web_search, parseo defensivo con zod, descarte de outliers,
dedup) y no se elimina; puede quedar como comando secundario.

## Stack

- **Backend:** servidor HTTP liviano con **Hono** (chico, TS-first). Sirve la UI
  estática y una API JSON.
- **Frontend:** **HTML + CSS + JS vanilla** — la maqueta aprobada como página
  real. Sin frameworks (minimalista).
- **Store:** archivo **`directorio.json`** (gitignoreado: contiene datos que el
  usuario acumula). Merge por dominio/nombre entre búsquedas.
- **Motor:** cliente Claude (`claude-opus-4-8`, adaptive thinking) + server tool
  `web_search`, reusando el patrón del retail; prompt nuevo orientado a
  proveedores B2B y extracción de contacto.

## Dominio nuevo — `Supplier`

```ts
interface SupplierContact {
  email?: string;
  phone?: string;
  whatsapp?: string;
  formUrl?: string;
}

interface Supplier {
  name: string;
  website?: string;
  material: string; // producto/material que provee
  region: string;
  wholesalePrice?: number; // precio de mayoreo por unidad
  currency?: string;
  moq?: number; // mínimo de compra (informativo)
  contact: SupplierContact;
  trusted: boolean; // empresa verificada vs desconocida
  notes?: string;
  firstSeen: string; // ISO — alta en el directorio
  lastSeen: string; // ISO — última vez visto/actualizado
}
```

## Ranking "mejor proveedor"

Regla **por niveles** (lexicográfica, explicable — no un score opaco), con
cadena de fallback como en el ranking de retail. Primero se descartan los
**outliers de precio** (un mayoreo sospechosamente bajo no se recomienda).

Elección de la mejor opción, en orden de preferencia:

1. **Confiable + en la región del usuario**, la de **menor precio de mayoreo**.
2. Si no hay: **confiable** (cualquier región), la de menor precio.
3. Si no hay: **en la región** (aunque no verificada), la de menor precio.
4. Último recurso: la de **menor precio** disponible, con aviso.

El **orden de la tabla** sigue el mismo criterio: primero confiables y en
región, luego por precio ascendente. El **MOQ se muestra** como dato pero **no
ordena**. Se reusa la **validación defensiva** (zod) ya existente.

Nota: "cercanía" en el MVP = **coincidencia exacta de región** (misma región que
la consulta). Distancias más finas (país/ciudad, envío) quedan fuera de alcance.

## Contacto (solo reunir)

El agente extrae, cuando estén disponibles: `website`, `email`, `phone`,
`whatsapp`, `formUrl`. **No envía nada.** El directorio queda con esa info para
que el usuario contacte por su cuenta.

## Directorio persistente

- `directorio.json` como fuente de verdad.
- Cada búsqueda **agrega o actualiza** proveedores (merge por dominio del
  `website` o, si falta, por nombre normalizado + región).
- Se conservan `firstSeen`/`lastSeen`; el contador "N en total · +M nuevos" de la
  UI sale de comparar el store antes/después de la búsqueda.

## Componentes (archivos chicos, alta cohesión)

- `domain/supplier.ts` — tipos (`Supplier`, `SupplierContact`).
- `directory/store.ts` — leer/escribir/mergear `directorio.json` (puro sobre el
  contenido; I/O de archivo aislado).
- `sourcing/supplierSource.ts` — agente que busca proveedores y extrae contacto
  (web_search); parseo defensivo con zod.
- `ranking/rankSuppliers.ts` — elegir el mejor + ordenar (precio + confiabilidad
  - cercanía; outliers).
- `server/app.ts` — Hono: rutas de UI estática + API.
- `web/` — `index.html`, `styles.css`, `app.js` (la maqueta aprobada).

## API

- `POST /api/buscar` — body `{ query, region }`. Corre el sourcing, mergea al
  store, responde el directorio actualizado + la mejor opción + cuántos nuevos.
- `GET /api/directorio` — devuelve el directorio actual (para pintar la UI al
  abrir sin buscar).

## Flujo de datos

```
navegador  --Buscar(producto, región)-->  POST /api/buscar
  -> sourcing agent (web_search) -> Supplier[] (parseados/validados)
  -> merge al store (directorio.json)
  -> ranking (mejor opción)
  <- { mejorOpcion, proveedores, nuevos, total }
navegador  <- pinta destacado + tabla
```

## Manejo de errores

- La API responde con envelope claro (`{ ok, data?, error? }`); nunca traga
  errores.
- Aislamiento de fallos de fuente (una fuente que falla no rompe la búsqueda),
  como ya se hace en el runner de retail.
- Validación en los límites: body de la API con zod; respuesta del modelo con
  zod (parseo defensivo por proveedor, descartar el inválido y continuar).
- Escritura del store atómica-ish (escribir a temporal y renombrar) para no
  corromper `directorio.json` ante un fallo.

## Testing (TDD)

- Piezas puras primero: merge del store, ranking (mejor/orden/outliers), parseo
  defensivo del sourcing (con el cliente Claude mockeado).
- API con el sourcing mockeado (sin red).
- Cobertura de casos borde: proveedor sin contacto, sin precio, duplicado entre
  búsquedas, región sin resultados.

## Reuso de lo existente

Del retail se reusa: patrón de cliente Claude + `web_search`, parseo defensivo
con zod, lógica de outliers de precio, dedup/merge (adaptada a proveedores),
separación stdout/stderr, config de entorno. El tooling (vitest, eslint,
prettier, CI, tsconfig) se mantiene.

## Fases de implementación (para el plan)

1. **Dominio + store:** `Supplier` + `directory/store.ts` (merge, persistencia).
2. **Sourcing:** `supplierSource.ts` (agente + parseo de proveedores/contacto).
3. **Ranking:** `rankSuppliers.ts` (mejor + orden + outliers).
4. **Backend:** `server/app.ts` (Hono, API + estáticos).
5. **Frontend:** `web/` (maqueta aprobada + fetch a la API).
6. **Integración + verificación** end-to-end (búsqueda real desde el navegador).

## Criterios de éxito

- Buscar un producto/material desde el navegador devuelve proveedores con
  contacto, marca la mejor opción y actualiza el directorio persistente.
- El directorio crece/actualiza correctamente entre búsquedas (sin duplicados).
- Ranking coherente (precio mayoreo + confiabilidad + cercanía; outliers fuera).
- Todo con TDD y checks en verde (typecheck + lint + test).
