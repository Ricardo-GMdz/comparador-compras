# Plan de Implementación — Sourcing de Proveedores (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App web local que, dada una búsqueda (producto/material + región), encuentra proveedores B2B con sus datos de contacto, los acumula en un directorio persistente y recomienda la mejor opción.

**Architecture:** Backend Hono sirve una UI estática (HTML/CSS/JS vanilla) y una API JSON. `POST /api/buscar` corre un agente de sourcing (Claude + `web_search`), mergea los proveedores a `directorio.json` y responde el directorio actualizado con la mejor opción; `GET /api/directorio` devuelve el estado actual. Se reusa el patrón del motor de retail (cliente Claude, parseo defensivo con zod, config de entorno, logger).

**Tech Stack:** TypeScript/Node (ESM), Hono + @hono/node-server, zod, @anthropic-ai/sdk (`web_search`), vitest, eslint, prettier. Store en archivo JSON.

---

## Estructura de archivos

Nuevos (rama `feat/supplier-sourcing`):

- `src/domain/supplier.ts` — tipos `Supplier`, `SupplierContact`, `SupplierCandidate`.
- `src/directory/store.ts` — `supplierKey`, `mergeSuppliers`, `loadDirectory`, `saveDirectory` (persistencia JSON, merge, escritura atómica).
- `src/sourcing/supplierSchema.ts` — validación zod + `parseSuppliers` (respuesta del modelo → `SupplierCandidate[]`).
- `src/sourcing/supplierSource.ts` — `createSupplierSource` (agente Claude + `web_search`; `fetch`/cliente reusado del patrón retail).
- `src/ranking/rankSuppliers.ts` — `rankSuppliers`, `selectBestSupplier` (niveles + outliers).
- `src/server/api.ts` — `buildApi(deps)` → app Hono con `/api/buscar` y `/api/directorio`.
- `src/server/index.ts` — entry: arma dependencias reales y hace `serve`.
- `web/index.html`, `web/styles.css`, `web/app.js` — frontend (maqueta aprobada + fetch a la API).

Reusa sin cambios: `src/config/env.ts` (ANTHROPIC_API_KEY), `src/logging/logger.ts`, el patrón de `src/sources/webSearchSource.ts`.

Convención de tipos (fuente de verdad para todas las tareas):

```ts
export interface SupplierContact {
  email?: string;
  phone?: string;
  whatsapp?: string;
  formUrl?: string;
}
// Lo que produce el sourcing (sin metadata del directorio).
export interface SupplierCandidate {
  name: string;
  website?: string;
  material: string;
  region: string;
  wholesalePrice?: number;
  currency?: string;
  moq?: number;
  contact: SupplierContact;
  trusted: boolean;
  notes?: string;
}
// Lo que vive en el directorio (candidate + timestamps ISO).
export interface Supplier extends SupplierCandidate {
  firstSeen: string;
  lastSeen: string;
}
```

---

## Task 1: Dependencias del servidor

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Instalar Hono y el adaptador de Node**

Run: `rtk pnpm add hono @hono/node-server`
Expected: agrega ambas a `dependencies`, actualiza `pnpm-lock.yaml`, install OK.

- [ ] **Step 2: Agregar scripts de servidor a package.json**

En `"scripts"`, agregar:

```json
"serve": "node dist/server/index.js",
"dev:serve": "tsc && node dist/server/index.js"
```

- [ ] **Step 3: Verificar typecheck sigue verde**

Run: `rtk pnpm run typecheck`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
rtk git add package.json pnpm-lock.yaml && rtk git commit -m "chore: agregar Hono para el servidor web de sourcing"
```

---

## Task 2: Tipos de dominio del proveedor

**Files:**
- Create: `src/domain/supplier.ts`

- [ ] **Step 1: Escribir los tipos**

```ts
// Tipos de dominio del sourcing de proveedores. Inmutables por convención.

/** Datos de contacto reunidos de un proveedor (nunca se envía nada). */
export interface SupplierContact {
  email?: string;
  phone?: string;
  whatsapp?: string;
  formUrl?: string;
}

/** Proveedor tal como lo produce el sourcing, sin metadata del directorio. */
export interface SupplierCandidate {
  name: string;
  /** Sitio del proveedor; base para la clave de identidad del directorio. */
  website?: string;
  /** Producto/material que provee. */
  material: string;
  /** Código de región (ej. "mx", "global"). */
  region: string;
  /** Precio de mayoreo por unidad. */
  wholesalePrice?: number;
  currency?: string;
  /** Mínimo de compra (informativo; no ordena el ranking). */
  moq?: number;
  contact: SupplierContact;
  /** Empresa verificada/reconocida vs desconocida. */
  trusted: boolean;
  notes?: string;
}

/** Proveedor persistido en el directorio: candidate + timestamps ISO 8601. */
export interface Supplier extends SupplierCandidate {
  firstSeen: string;
  lastSeen: string;
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `rtk pnpm run typecheck`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
rtk git add src/domain/supplier.ts && rtk git commit -m "feat: tipos de dominio del proveedor (Supplier)"
```

---

## Task 3: Clave de identidad del proveedor (`supplierKey`)

La identidad de un proveedor en el directorio es el **dominio del sitio** (si hay); si falta, **nombre normalizado + región**. Así dos búsquedas que traen el mismo proveedor se fusionan.

**Files:**
- Create: `src/directory/store.ts`
- Test: `src/directory/store.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { supplierKey } from "./store.js";
import type { SupplierCandidate } from "../domain/supplier.js";

function candidate(overrides: Partial<SupplierCandidate> = {}): SupplierCandidate {
  return {
    name: "Aceros del Norte",
    material: "lámina",
    region: "mx",
    contact: {},
    trusted: true,
    ...overrides,
  };
}

describe("supplierKey", () => {
  it("usa el dominio del sitio, ignorando protocolo/subdominio-www y path", () => {
    const a = supplierKey(candidate({ website: "https://www.aceros.com/productos" }));
    const b = supplierKey(candidate({ website: "http://aceros.com/otra" }));
    expect(a).toBe(b);
  });

  it("cae a nombre+region normalizados cuando no hay sitio", () => {
    const a = supplierKey(candidate({ name: "  Aceros del Norte ", region: "MX" }));
    const b = supplierKey(candidate({ name: "aceros del norte", region: "mx" }));
    expect(a).toBe(b);
  });

  it("distingue proveedores sin sitio de distinta región", () => {
    const a = supplierKey(candidate({ region: "mx" }));
    const b = supplierKey(candidate({ region: "ar" }));
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Correr el test — debe FALLAR**

Run: `rtk pnpm exec vitest run src/directory/store.test.ts`
Expected: FAIL — `supplierKey` no existe.

- [ ] **Step 3: Implementación mínima**

```ts
// Directorio de proveedores: identidad, merge y persistencia en JSON.

import type { Supplier, SupplierCandidate } from "../domain/supplier.js";

/** Extrae el dominio (sin www) de una URL; undefined si no es válida. */
function domainOf(website: string | undefined): string | undefined {
  if (website === undefined) {
    return undefined;
  }
  try {
    return new URL(website).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Clave de identidad de un proveedor: dominio del sitio si existe; si no,
 * nombre normalizado + región. Determina qué proveedores se fusionan.
 */
export function supplierKey(supplier: SupplierCandidate): string {
  const domain = domainOf(supplier.website);
  if (domain !== undefined) {
    return `d:${domain}`;
  }
  const name = supplier.name.trim().toLowerCase();
  const region = supplier.region.trim().toLowerCase();
  return `n:${name}|${region}`;
}
```

- [ ] **Step 4: Correr el test — debe PASAR**

Run: `rtk pnpm exec vitest run src/directory/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/directory/store.ts src/directory/store.test.ts && rtk git commit -m "feat: supplierKey (identidad por dominio o nombre+region)"
```

---

## Task 4: Merge de proveedores al directorio (`mergeSuppliers`)

Fusiona candidatos nuevos con el directorio existente. Un candidato con clave ya presente **actualiza** el proveedor (nuevos datos + `lastSeen`), conservando su `firstSeen`. Uno nuevo se agrega con `firstSeen = lastSeen = now`. Devuelve el directorio nuevo y cuántos se agregaron.

**Files:**
- Modify: `src/directory/store.ts`
- Test: `src/directory/store.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// (agregar al mismo archivo store.test.ts)
import { mergeSuppliers } from "./store.js";
import type { Supplier } from "../domain/supplier.js";

const NOW = "2026-07-01T10:00:00.000Z";
const BEFORE = "2026-06-01T10:00:00.000Z";

describe("mergeSuppliers", () => {
  it("agrega un proveedor nuevo con firstSeen y lastSeen = now", () => {
    const result = mergeSuppliers([], [candidate({ website: "https://a.com" })], NOW);
    expect(result.added).toBe(1);
    expect(result.suppliers).toHaveLength(1);
    expect(result.suppliers[0]?.firstSeen).toBe(NOW);
    expect(result.suppliers[0]?.lastSeen).toBe(NOW);
  });

  it("actualiza un proveedor existente conservando firstSeen y refrescando lastSeen", () => {
    const existing: Supplier = {
      ...candidate({ website: "https://a.com", wholesalePrice: 200 }),
      firstSeen: BEFORE,
      lastSeen: BEFORE,
    };
    const result = mergeSuppliers([existing], [candidate({ website: "https://a.com", wholesalePrice: 180 })], NOW);
    expect(result.added).toBe(0);
    expect(result.suppliers).toHaveLength(1);
    expect(result.suppliers[0]?.wholesalePrice).toBe(180);
    expect(result.suppliers[0]?.firstSeen).toBe(BEFORE);
    expect(result.suppliers[0]?.lastSeen).toBe(NOW);
  });

  it("no muta el directorio existente", () => {
    const existing: Supplier = { ...candidate({ website: "https://a.com" }), firstSeen: BEFORE, lastSeen: BEFORE };
    const snapshot = { ...existing };
    mergeSuppliers([existing], [candidate({ website: "https://a.com", wholesalePrice: 1 })], NOW);
    expect(existing).toEqual(snapshot);
  });
});
```

- [ ] **Step 2: Correr — debe FALLAR**

Run: `rtk pnpm exec vitest run src/directory/store.test.ts`
Expected: FAIL — `mergeSuppliers` no existe.

- [ ] **Step 3: Implementación**

```ts
// (agregar a store.ts)

/** Resultado de un merge: el directorio nuevo y cuántos proveedores se agregaron. */
export interface MergeResult {
  suppliers: readonly Supplier[];
  added: number;
}

/**
 * Fusiona candidatos con el directorio existente (inmutable). Actualiza los que
 * ya están (por clave), conservando `firstSeen` y refrescando `lastSeen`; agrega
 * los nuevos con `firstSeen = lastSeen = now`.
 */
export function mergeSuppliers(
  existing: readonly Supplier[],
  incoming: readonly SupplierCandidate[],
  now: string,
): MergeResult {
  const byKey = new Map<string, Supplier>();
  for (const supplier of existing) {
    byKey.set(supplierKey(supplier), supplier);
  }

  let added = 0;
  for (const candidate of incoming) {
    const key = supplierKey(candidate);
    const prev = byKey.get(key);
    if (prev === undefined) {
      byKey.set(key, { ...candidate, firstSeen: now, lastSeen: now });
      added += 1;
    } else {
      byKey.set(key, { ...candidate, firstSeen: prev.firstSeen, lastSeen: now });
    }
  }

  return { suppliers: [...byKey.values()], added };
}
```

- [ ] **Step 4: Correr — debe PASAR**

Run: `rtk pnpm exec vitest run src/directory/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/directory/store.ts src/directory/store.test.ts && rtk git commit -m "feat: mergeSuppliers (merge inmutable con timestamps)"
```

---

## Task 5: Persistencia del directorio (`loadDirectory` / `saveDirectory`)

Carga y guarda `directorio.json`. Si el archivo no existe, el directorio arranca vacío. La escritura es atómica (temp + rename) para no corromper el archivo.

**Files:**
- Modify: `src/directory/store.ts`
- Test: `src/directory/store.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// (agregar a store.test.ts)
import { loadDirectory, saveDirectory } from "./store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("loadDirectory / saveDirectory", () => {
  it("devuelve un directorio vacío cuando el archivo no existe", async () => {
    const path = join(tmpdir(), "no-existe-directorio.json");
    const dir = await loadDirectory(path);
    expect(dir).toEqual([]);
  });

  it("persiste y relee los proveedores (round-trip)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "dir-"));
    const path = join(tmp, "directorio.json");
    const suppliers: Supplier[] = [
      { ...candidate({ website: "https://a.com" }), firstSeen: NOW, lastSeen: NOW },
    ];
    await saveDirectory(path, suppliers);
    const reloaded = await loadDirectory(path);
    expect(reloaded).toEqual(suppliers);
    rmSync(tmp, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Correr — debe FALLAR**

Run: `rtk pnpm exec vitest run src/directory/store.test.ts`
Expected: FAIL — funciones no existen.

- [ ] **Step 3: Implementación**

```ts
// (agregar a store.ts)
import { readFile, writeFile, rename } from "node:fs/promises";
import { z } from "zod";

// Esquema del archivo persistido: validamos al leer (dato de un archivo externo).
const contactSchema = z.object({
  email: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  formUrl: z.string().optional(),
});
const supplierSchema = z.object({
  name: z.string(),
  website: z.string().optional(),
  material: z.string(),
  region: z.string(),
  wholesalePrice: z.number().optional(),
  currency: z.string().optional(),
  moq: z.number().optional(),
  contact: contactSchema,
  trusted: z.boolean(),
  notes: z.string().optional(),
  firstSeen: z.string(),
  lastSeen: z.string(),
});
const directorySchema = z.array(supplierSchema);

/**
 * Carga el directorio desde `path`. Si el archivo no existe, devuelve `[]`.
 * Valida el contenido con zod (falla explícito si el archivo está corrupto).
 */
export async function loadDirectory(path: string): Promise<readonly Supplier[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return directorySchema.parse(JSON.parse(raw));
}

/** Guarda el directorio en `path` de forma atómica (escribe a temp y renombra). */
export async function saveDirectory(path: string, suppliers: readonly Supplier[]): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(suppliers, null, 2), "utf8");
  await rename(tmp, path);
}
```

- [ ] **Step 4: Correr — debe PASAR**

Run: `rtk pnpm exec vitest run src/directory/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/directory/store.ts src/directory/store.test.ts && rtk git commit -m "feat: persistencia del directorio (load/save atómico, validado con zod)"
```

---

## Task 6: Parseo defensivo del sourcing (`parseSuppliers`)

Valida y mapea la respuesta JSON del modelo a `SupplierCandidate[]`. Nivel superior debe ser un arreglo; cada item se valida por separado (descartar el malformado y continuar). Descarta precios de mayoreo no positivos (los deja como `undefined`, no descarta el proveedor — un proveedor sin precio sigue siendo útil).

**Files:**
- Create: `src/sourcing/supplierSchema.ts`
- Test: `src/sourcing/supplierSchema.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { parseSuppliers } from "./supplierSchema.js";

describe("parseSuppliers", () => {
  const ok = {
    suppliers: [
      {
        name: "Láminas Express",
        website: "https://laminasexpress.mx",
        material: "lámina galvanizada",
        wholesalePrice: 165,
        currency: "MXN",
        moq: 200,
        contact: { email: "ventas@laminasexpress.mx", whatsapp: "+52 33 1234 5678" },
        trusted: true,
      },
    ],
  };

  it("mapea proveedores válidos con la región dada", () => {
    const result = parseSuppliers(ok, "mx");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "Láminas Express",
      material: "lámina galvanizada",
      region: "mx",
      wholesalePrice: 165,
      currency: "MXN",
      trusted: true,
      contact: { email: "ventas@laminasexpress.mx", whatsapp: "+52 33 1234 5678" },
    });
  });

  it("descarta un item malformado sin perder los válidos", () => {
    const data = { suppliers: [{ material: "sin nombre" }, ok.suppliers[0]] };
    const result = parseSuppliers(data, "mx");
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("Láminas Express");
  });

  it("omite un precio de mayoreo no positivo pero conserva el proveedor", () => {
    const data = { suppliers: [{ name: "X", material: "y", contact: {}, wholesalePrice: 0 }] };
    const result = parseSuppliers(data, "mx");
    expect(result).toHaveLength(1);
    expect(result[0]?.wholesalePrice).toBeUndefined();
  });

  it("asume trusted=false cuando no viene", () => {
    const data = { suppliers: [{ name: "X", material: "y", contact: {} }] };
    const result = parseSuppliers(data, "mx");
    expect(result[0]?.trusted).toBe(false);
  });

  it("lanza cuando la forma de nivel superior es inválida", () => {
    expect(() => parseSuppliers({ foo: 1 }, "mx")).toThrow();
  });
});
```

- [ ] **Step 2: Correr — debe FALLAR**

Run: `rtk pnpm exec vitest run src/sourcing/supplierSchema.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementación**

```ts
// Validación y parseo defensivo de la respuesta del modelo → SupplierCandidate[].

import { z } from "zod";
import type { SupplierCandidate, SupplierContact } from "../domain/supplier.js";

const rawContactSchema = z.object({
  email: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  formUrl: z.string().optional(),
});

const rawSupplierSchema = z.object({
  name: z.string().min(1),
  website: z.string().optional(),
  material: z.string().min(1),
  wholesalePrice: z.number().optional(),
  currency: z.string().optional(),
  moq: z.number().optional(),
  contact: rawContactSchema.optional(),
  trusted: z.boolean().optional(),
  notes: z.string().optional(),
});

const rawResponseSchema = z.object({ suppliers: z.array(z.unknown()) });

type RawSupplier = z.infer<typeof rawSupplierSchema>;

/** Precio válido: número finito y positivo; si no, undefined (no descarta al proveedor). */
function validPrice(price: number | undefined): number | undefined {
  return price !== undefined && Number.isFinite(price) && price > 0 ? price : undefined;
}

/** Contacto limpio: solo campos presentes y no vacíos. */
function toContact(raw: RawSupplier["contact"]): SupplierContact {
  const c = raw ?? {};
  const pick = (v: string | undefined): string | undefined =>
    v !== undefined && v.trim().length > 0 ? v.trim() : undefined;
  const contact: SupplierContact = {};
  const email = pick(c.email);
  const phone = pick(c.phone);
  const whatsapp = pick(c.whatsapp);
  const formUrl = pick(c.formUrl);
  if (email !== undefined) contact.email = email;
  if (phone !== undefined) contact.phone = phone;
  if (whatsapp !== undefined) contact.whatsapp = whatsapp;
  if (formUrl !== undefined) contact.formUrl = formUrl;
  return contact;
}

function toCandidate(raw: RawSupplier, region: string): SupplierCandidate {
  const wholesalePrice = validPrice(raw.wholesalePrice);
  return {
    name: raw.name,
    material: raw.material,
    region,
    trusted: raw.trusted ?? false,
    contact: toContact(raw.contact),
    ...(raw.website !== undefined ? { website: raw.website } : {}),
    ...(wholesalePrice !== undefined ? { wholesalePrice } : {}),
    ...(raw.currency !== undefined ? { currency: raw.currency } : {}),
    ...(raw.moq !== undefined ? { moq: raw.moq } : {}),
    ...(raw.notes !== undefined ? { notes: raw.notes } : {}),
  };
}

/**
 * Valida la respuesta del modelo y mapea a `SupplierCandidate[]`. Lanza si el
 * nivel superior no es `{ suppliers: [...] }`; descarta items individuales
 * malformados (parseo defensivo).
 */
export function parseSuppliers(data: unknown, region: string): readonly SupplierCandidate[] {
  const parsed = rawResponseSchema.parse(data);
  const candidates: SupplierCandidate[] = [];
  for (const raw of parsed.suppliers) {
    const item = rawSupplierSchema.safeParse(raw);
    if (item.success) {
      candidates.push(toCandidate(item.data, region));
    }
  }
  return candidates;
}
```

- [ ] **Step 4: Correr — debe PASAR**

Run: `rtk pnpm exec vitest run src/sourcing/supplierSchema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/sourcing/supplierSchema.ts src/sourcing/supplierSchema.test.ts && rtk git commit -m "feat: parseSuppliers (parseo defensivo del sourcing)"
```

---

## Task 7: Agente de sourcing (`createSupplierSource`)

Consulta el modelo con `web_search` pidiendo proveedores B2B + contacto, y mapea con `parseSuppliers`. El cliente Anthropic es inyectable para testear sin red. Sigue el patrón de `src/sources/webSearchSource.ts` (adaptive thinking, tool `web_search`, manejo de `pause_turn`/errores).

**Files:**
- Create: `src/sourcing/supplierSource.ts`
- Test: `src/sourcing/supplierSource.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi } from "vitest";
import { createSupplierSource } from "./supplierSource.js";

// Cliente Anthropic mínimo mockeado: solo messages.create.
function fakeClient(text: string) {
  return {
    messages: {
      create: vi.fn(async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text }],
      })),
    },
  } as never;
}

const RESPONSE = JSON.stringify({
  suppliers: [
    { name: "Aceros del Norte", website: "https://aceros.mx", material: "lámina", wholesalePrice: 180, currency: "MXN", contact: { email: "v@aceros.mx" }, trusted: true },
  ],
});

describe("createSupplierSource", () => {
  it("busca proveedores y los mapea a SupplierCandidate", async () => {
    const source = createSupplierSource({ client: fakeClient(RESPONSE) });
    const result = await source.search({ query: "lámina galvanizada", region: "mx" });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "Aceros del Norte", region: "mx", wholesalePrice: 180 });
  });

  it("devuelve [] cuando el modelo no da texto utilizable", async () => {
    const source = createSupplierSource({ client: fakeClient("") });
    const result = await source.search({ query: "x", region: "mx" });
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr — debe FALLAR**

Run: `rtk pnpm exec vitest run src/sourcing/supplierSource.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementación**

```ts
// Fuente de proveedores basada en el server tool web_search del SDK de Anthropic.

import Anthropic from "@anthropic-ai/sdk";
import type { SupplierCandidate } from "../domain/supplier.js";
import { logger } from "../logging/logger.js";
import { parseSuppliers } from "./supplierSchema.js";

const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 16000;
const WEB_SEARCH_TOOL_TYPE = "web_search_20260209";
const WEB_SEARCH_TOOL_NAME = "web_search";
const MAX_WEB_SEARCH_USES = 5;

/** Consulta a la que responde una fuente de proveedores. */
export interface SupplierQuery {
  query: string;
  region: string;
}

/** Dependencias: el cliente Anthropic (inyectable para tests). */
export interface SupplierSourceDeps {
  client: Anthropic;
}

export interface SupplierSource {
  search(query: SupplierQuery): Promise<readonly SupplierCandidate[]>;
}

function buildSystemPrompt(): string {
  return [
    "Sos un asistente de sourcing B2B: encontrás PROVEEDORES (empresas/páginas que",
    "venden al por mayor) de un material/producto, para comprar y revender.",
    "Usá la búsqueda web para encontrar proveedores reales y sus datos de contacto.",
    "Respondé EXCLUSIVAMENTE con un objeto JSON (sin texto extra, sin ```), con la forma:",
    '{ "suppliers": [ { "name": string, "website"?: string, "material": string,',
    '  "wholesalePrice"?: number, "currency"?: string (ISO 4217), "moq"?: number,',
    '  "contact"?: { "email"?: string, "phone"?: string, "whatsapp"?: string, "formUrl"?: string },',
    '  "trusted"?: boolean, "notes"?: string } ] }.',
    'Marcá "trusted": true solo para empresas reconocidas/verificables (con datos de contacto reales).',
    'Priorizá precio de mayoreo y datos de contacto. Si no encontrás, devolvé { "suppliers": [] }.',
  ].join("\n");
}

function buildUserPrompt(q: SupplierQuery): string {
  return [
    `Buscá proveedores al por mayor de: "${q.query}".`,
    `Región objetivo: "${q.region}". Preferí proveedores de esa región y su moneda.`,
    "Incluí su web y datos de contacto (email/teléfono/WhatsApp/formulario) cuando estén.",
  ].join("\n");
}

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** Recorta el objeto JSON del texto si el modelo lo envuelve en prosa. */
function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("La respuesta del modelo no contiene un objeto JSON válido.");
  }
}

/** Crea una fuente de proveedores que usa web_search. */
export function createSupplierSource(deps: SupplierSourceDeps): SupplierSource {
  async function search(q: SupplierQuery): Promise<readonly SupplierCandidate[]> {
    const response = await deps.client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system: buildSystemPrompt(),
      tools: [{ type: WEB_SEARCH_TOOL_TYPE, name: WEB_SEARCH_TOOL_NAME, max_uses: MAX_WEB_SEARCH_USES }],
      messages: [{ role: "user", content: buildUserPrompt(q) }],
    });

    const text = extractText(response.content);
    if (text.length === 0) {
      logger.warn("sourcing: el modelo no devolvió texto utilizable", { query: q.query, region: q.region });
      return [];
    }
    return parseSuppliers(parseJsonObject(text), q.region);
  }

  return { search };
}
```

Nota: el fake del test satisface la parte usada del cliente (`messages.create`) vía `as never`.

- [ ] **Step 4: Correr — debe PASAR**

Run: `rtk pnpm exec vitest run src/sourcing/supplierSource.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificar typecheck + lint**

Run: `rtk pnpm run typecheck && rtk pnpm run lint`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
rtk git add src/sourcing/supplierSource.ts src/sourcing/supplierSource.test.ts && rtk git commit -m "feat: createSupplierSource (agente web_search de proveedores)"
```

---

## Task 8: Ranking de proveedores (`rankSuppliers` / `selectBestSupplier`)

Ordena y elige la mejor opción por niveles (confiable + región + menor precio), descartando outliers de precio (mayoreo sospechosamente bajo). Espeja el estilo de `compareOffers` del retail.

**Files:**
- Create: `src/ranking/rankSuppliers.ts`
- Test: `src/ranking/rankSuppliers.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { rankSuppliers, selectBestSupplier } from "./rankSuppliers.js";
import type { Supplier } from "../domain/supplier.js";

const NOW = "2026-07-01T00:00:00.000Z";
function sup(o: Partial<Supplier>): Supplier {
  return {
    name: "S", material: "lámina", region: "mx", contact: {}, trusted: true,
    firstSeen: NOW, lastSeen: NOW, ...o,
  };
}

describe("selectBestSupplier", () => {
  it("elige confiable + en región + más barato", () => {
    const list = [
      sup({ name: "caro-region", region: "mx", wholesalePrice: 200, trusted: true }),
      sup({ name: "barato-region", region: "mx", wholesalePrice: 150, trusted: true }),
      sup({ name: "barato-otro", region: "ar", wholesalePrice: 100, trusted: true }),
    ];
    expect(selectBestSupplier(list, "mx")?.name).toBe("barato-region");
  });

  it("cae a confiable de otra región si no hay en la región", () => {
    const list = [
      sup({ name: "otro", region: "ar", wholesalePrice: 100, trusted: true }),
      sup({ name: "no-conf", region: "mx", wholesalePrice: 90, trusted: false }),
    ];
    expect(selectBestSupplier(list, "mx")?.name).toBe("otro");
  });

  it("descarta un precio outlier (sospechosamente bajo) del best", () => {
    const list = [
      sup({ name: "error", region: "mx", wholesalePrice: 5, trusted: true }),
      sup({ name: "a", region: "mx", wholesalePrice: 150, trusted: true }),
      sup({ name: "b", region: "mx", wholesalePrice: 160, trusted: true }),
      sup({ name: "c", region: "mx", wholesalePrice: 170, trusted: true }),
    ];
    expect(selectBestSupplier(list, "mx")?.name).toBe("a");
  });
});

describe("rankSuppliers", () => {
  it("ordena confiables+region primero, luego por precio ascendente", () => {
    const list = [
      sup({ name: "z", region: "ar", wholesalePrice: 100, trusted: true }),
      sup({ name: "y", region: "mx", wholesalePrice: 200, trusted: true }),
      sup({ name: "x", region: "mx", wholesalePrice: 150, trusted: true }),
    ];
    expect(rankSuppliers(list, "mx").map((s) => s.name)).toEqual(["x", "y", "z"]);
  });
});
```

- [ ] **Step 2: Correr — debe FALLAR**

Run: `rtk pnpm exec vitest run src/ranking/rankSuppliers.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementación**

```ts
// Ranking de proveedores: orden y mejor opción por niveles, con descarte de outliers.

import type { Supplier } from "../domain/supplier.js";

/** Fracción de la mediana por debajo de la cual un precio de mayoreo es outlier. */
const PRICE_OUTLIER_MIN_RATIO = 0.4;
/** Muestra mínima para aplicar la detección de outliers (evita falsos con pocos datos). */
const PRICE_OUTLIER_MIN_SAMPLE = 4;
/** Precio usado al ordenar cuando el proveedor no tiene precio (van al final). */
const NO_PRICE = Number.POSITIVE_INFINITY;

function priceOf(s: Supplier): number {
  return s.wholesalePrice ?? NO_PRICE;
}

/** Mediana de los precios de mayoreo presentes (>0); undefined si no hay ninguno. */
function medianWholesale(suppliers: readonly Supplier[]): number | undefined {
  const prices = suppliers
    .map((s) => s.wholesalePrice)
    .filter((p): p is number => p !== undefined && Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);
  if (prices.length === 0) {
    return undefined;
  }
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];
}

/** Construye un predicado de outlier según la muestra (siempre false si es chica o sin mediana). */
function makeIsOutlier(suppliers: readonly Supplier[]): (s: Supplier) => boolean {
  const withPrice = suppliers.filter((s) => s.wholesalePrice !== undefined);
  const median = medianWholesale(suppliers);
  if (withPrice.length < PRICE_OUTLIER_MIN_SAMPLE || median === undefined) {
    return () => false;
  }
  return (s) => s.wholesalePrice !== undefined && s.wholesalePrice < median * PRICE_OUTLIER_MIN_RATIO;
}

function byPriceAsc(a: Supplier, b: Supplier): number {
  return priceOf(a) - priceOf(b);
}

/**
 * Ordena los proveedores: primero confiables y en la región del usuario, luego
 * por precio de mayoreo ascendente (los sin precio, al final).
 */
export function rankSuppliers(suppliers: readonly Supplier[], region: string): readonly Supplier[] {
  const inRegion = region.trim().toLowerCase();
  const score = (s: Supplier): number =>
    (s.trusted ? 2 : 0) + (s.region.trim().toLowerCase() === inRegion ? 1 : 0);
  return [...suppliers].sort((a, b) => score(b) - score(a) || byPriceAsc(a, b));
}

/**
 * Elige la mejor opción por niveles (descarta outliers de precio):
 * 1) confiable + en región, más barato; 2) confiable; 3) en región; 4) el más barato.
 */
export function selectBestSupplier(suppliers: readonly Supplier[], region: string): Supplier | undefined {
  const inRegion = region.trim().toLowerCase();
  const isOutlier = makeIsOutlier(suppliers);
  const eligible = suppliers.filter((s) => !isOutlier(s));
  const isRegion = (s: Supplier): boolean => s.region.trim().toLowerCase() === inRegion;
  const cheapest = (list: readonly Supplier[]): Supplier | undefined =>
    list.length === 0 ? undefined : [...list].sort(byPriceAsc)[0];

  return (
    cheapest(eligible.filter((s) => s.trusted && isRegion(s))) ??
    cheapest(eligible.filter((s) => s.trusted)) ??
    cheapest(eligible.filter(isRegion)) ??
    cheapest(eligible)
  );
}
```

- [ ] **Step 4: Correr — debe PASAR**

Run: `rtk pnpm exec vitest run src/ranking/rankSuppliers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/ranking/rankSuppliers.ts src/ranking/rankSuppliers.test.ts && rtk git commit -m "feat: ranking de proveedores (niveles + outliers)"
```

---

## Task 9: API HTTP (`buildApi`)

App Hono con las dos rutas, con dependencias inyectadas (fuente, funciones de store) para testear sin red ni archivos.

**Files:**
- Create: `src/server/api.ts`
- Test: `src/server/api.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi } from "vitest";
import { buildApi } from "./api.js";
import type { Supplier } from "../domain/supplier.js";

const NOW = "2026-07-01T00:00:00.000Z";
function fakeDeps(existing: Supplier[] = []) {
  const store = { current: existing as readonly Supplier[] };
  return {
    store,
    deps: {
      source: { search: vi.fn(async () => [
        { name: "Aceros", website: "https://a.mx", material: "lámina", region: "mx", trusted: true, contact: {}, wholesalePrice: 180 },
      ]) },
      loadDirectory: vi.fn(async () => store.current),
      saveDirectory: vi.fn(async (_p: string, s: readonly Supplier[]) => { store.current = s; }),
      now: () => NOW,
      directoryPath: "/tmp/x.json",
    },
  };
}

describe("API", () => {
  it("GET /api/directorio devuelve el directorio actual", async () => {
    const { deps } = fakeDeps([{ name: "X", material: "y", region: "mx", trusted: true, contact: {}, firstSeen: NOW, lastSeen: NOW }]);
    const app = buildApi(deps);
    const res = await app.request("/api/directorio");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suppliers).toHaveLength(1);
  });

  it("POST /api/buscar corre el sourcing, mergea y responde mejor opción + nuevos", async () => {
    const { deps } = fakeDeps();
    const app = buildApi(deps);
    const res = await app.request("/api/buscar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "lámina", region: "mx" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nuevos).toBe(1);
    expect(body.mejorOpcion?.name).toBe("Aceros");
    expect(body.suppliers).toHaveLength(1);
  });

  it("POST /api/buscar valida el body (400 si falta query)", async () => {
    const { deps } = fakeDeps();
    const app = buildApi(deps);
    const res = await app.request("/api/buscar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ region: "mx" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/buscar responde 502 con envelope de error si el sourcing falla", async () => {
    const { deps } = fakeDeps();
    deps.source.search = vi.fn(async () => {
      throw new Error("web_search caído");
    });
    const app = buildApi(deps);
    const res = await app.request("/api/buscar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "lámina", region: "mx" }),
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Correr — debe FALLAR**

Run: `rtk pnpm exec vitest run src/server/api.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementación**

```ts
// API HTTP (Hono): buscar proveedores y leer el directorio. Dependencias inyectadas.

import { Hono } from "hono";
import { z } from "zod";
import type { Supplier } from "../domain/supplier.js";
import type { SupplierSource } from "../sourcing/supplierSource.js";
import { mergeSuppliers } from "../directory/store.js";
import { rankSuppliers, selectBestSupplier } from "../ranking/rankSuppliers.js";
import { logger } from "../logging/logger.js";

/** Dependencias de la API (inyectables para test). */
export interface ApiDeps {
  source: SupplierSource;
  loadDirectory: (path: string) => Promise<readonly Supplier[]>;
  saveDirectory: (path: string, suppliers: readonly Supplier[]) => Promise<void>;
  now: () => string;
  directoryPath: string;
}

const buscarSchema = z.object({
  query: z.string().min(1),
  region: z.string().min(1).default("global"),
});

export function buildApi(deps: ApiDeps): Hono {
  const app = new Hono();

  app.get("/api/directorio", async (c) => {
    const suppliers = await deps.loadDirectory(deps.directoryPath);
    const region = c.req.query("region") ?? "global";
    return c.json({ ok: true, suppliers: rankSuppliers(suppliers, region) });
  });

  app.post("/api/buscar", async (c) => {
    const parsed = buscarSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ ok: false, error: "Parámetros inválidos: se requiere 'query'." }, 400);
    }
    const { query, region } = parsed.data;

    try {
      const candidates = await deps.source.search({ query, region });
      const existing = await deps.loadDirectory(deps.directoryPath);
      const { suppliers, added } = mergeSuppliers(existing, candidates, deps.now());
      await deps.saveDirectory(deps.directoryPath, suppliers);
      return c.json({
        ok: true,
        suppliers: rankSuppliers(suppliers, region),
        mejorOpcion: selectBestSupplier(suppliers, region) ?? null,
        nuevos: added,
        total: suppliers.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error inesperado";
      logger.error("buscar: falló el sourcing", { query, region, error: message });
      return c.json({ ok: false, error: `Falló la búsqueda: ${message}` }, 502);
    }
  });

  return app;
}
```

- [ ] **Step 4: Correr — debe PASAR**

Run: `rtk pnpm exec vitest run src/server/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/server/api.ts src/server/api.test.ts && rtk git commit -m "feat: API de sourcing (Hono: /api/buscar y /api/directorio)"
```

---

## Task 10: Frontend (maqueta aprobada)

Página estática que consume la API. Reproduce el diseño aprobado (indigo→violeta, chips, pills, mejor opción destacada + tabla).

**Files:**
- Create: `web/index.html`
- Create: `web/styles.css`
- Create: `web/app.js`

- [ ] **Step 1: `web/index.html`**

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Proveedores</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="wrap">
      <header class="topbar">
        <div class="brand"><span class="logo">⌁</span> Proveedores</div>
        <div class="counters"><span id="total" class="chip chip-indigo">0 en el directorio</span></div>
      </header>

      <form id="buscar" class="search">
        <input id="query" class="input" placeholder="Ej. láminas de metal galvanizadas" />
        <input id="region" class="input region" value="mx" />
        <button class="btn" type="submit">Buscar</button>
      </form>

      <section id="best" class="best hidden"></section>
      <section id="tabla"></section>
      <p id="status" class="status"></p>
    </main>
    <script src="/app.js" type="module"></script>
  </body>
</html>
```

- [ ] **Step 2: `web/styles.css`** (minimalista, acento indigo→violeta)

```css
:root { --indigo:#4f46e5; --violet:#7c3aed; --ink:#1f1b30; --muted:#8b889e; --line:#ececf3; }
* { box-sizing: border-box; }
body { margin:0; font-family:system-ui,-apple-system,"Inter",sans-serif; color:var(--ink); background:#faf9fe; }
.wrap { max-width:960px; margin:0 auto; padding:28px 20px; }
.topbar { display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; }
.brand { display:flex; align-items:center; gap:10px; font-weight:700; }
.logo { width:30px; height:30px; border-radius:8px; background:linear-gradient(135deg,var(--indigo),var(--violet)); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; }
.chip { font-size:12px; font-weight:600; padding:5px 11px; border-radius:999px; }
.chip-indigo { background:#efeefe; color:var(--indigo); }
.chip-green { background:#e9f9ef; color:#16a34a; }
.chip-amber { background:#fef3e2; color:#b45309; }
.search { display:flex; gap:10px; margin-bottom:22px; }
.input { flex:1; background:#fff; border:1px solid #e6e6f0; border-radius:12px; padding:12px 15px; font-size:14px; }
.input.region { flex:0 0 90px; }
.btn { background:linear-gradient(135deg,var(--indigo),#6d5cf0); color:#fff; border:0; border-radius:12px; padding:12px 22px; font-weight:600; cursor:pointer; }
.best { position:relative; background:#fff; border:1px solid #e6e6f0; border-radius:14px; padding:18px 20px 18px 24px; margin-bottom:22px; overflow:hidden; box-shadow:0 4px 18px rgba(79,70,229,.07); }
.best::before { content:""; position:absolute; left:0; top:0; bottom:0; width:5px; background:linear-gradient(180deg,var(--indigo),var(--violet)); }
.best .badge { display:inline-block; background:#f3f1ff; color:var(--indigo); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.6px; padding:4px 10px; border-radius:999px; }
.best h3 { margin:9px 0 2px; font-size:19px; }
.best .meta { color:var(--muted); font-size:13px; }
.contacts { display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }
.contacts a { text-decoration:none; background:#f4f4f8; color:var(--indigo); font-size:12px; padding:5px 10px; border-radius:8px; }
table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:14px; overflow:hidden; font-size:13px; }
th { text-align:left; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.5px; font-weight:600; padding:13px 16px; }
td { padding:14px 16px; border-top:1px solid #f1f1f6; }
.tag { background:#eef; color:var(--indigo); padding:3px 9px; border-radius:6px; font-size:12px; }
.status { color:var(--muted); font-size:13px; margin-top:14px; }
.hidden { display:none; }
```

- [ ] **Step 3: `web/app.js`** (fetch a la API + render)

```js
const $ = (id) => document.getElementById(id);

function contactLinks(c) {
  const items = [];
  if (c.website) items.push(`<a href="${c.website}" target="_blank">🌐 Web</a>`);
  if (c.email) items.push(`<a href="mailto:${c.email}">✉️ Email</a>`);
  if (c.phone) items.push(`<a href="tel:${c.phone}">📞 Tel</a>`);
  if (c.whatsapp) items.push(`<a href="https://wa.me/${c.whatsapp.replace(/[^0-9]/g, "")}" target="_blank">💬 WhatsApp</a>`);
  if (c.formUrl) items.push(`<a href="${c.formUrl}" target="_blank">📝 Formulario</a>`);
  return items.join("");
}

function contactFor(s) {
  return contactLinks({ website: s.website, ...s.contact });
}

function price(s) {
  return s.wholesalePrice !== undefined ? `$${s.wholesalePrice}${s.currency ? " " + s.currency : ""}` : "—";
}

function renderBest(best) {
  const el = $("best");
  if (!best) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  el.classList.remove("hidden");
  el.innerHTML = `
    <span class="badge">★ Mejor opción</span>
    <h3>${best.name}</h3>
    <div class="meta">${best.material} · ${best.region} · ${price(best)}${best.moq ? " · mín. " + best.moq : ""}</div>
    <div class="contacts">${contactFor(best)}</div>`;
}

function renderTable(suppliers) {
  const rows = suppliers.map((s) => `
    <tr>
      <td><strong>${s.name}</strong></td>
      <td><span class="tag">${s.material}</span></td>
      <td>${price(s)}</td>
      <td>${s.moq ?? "—"}</td>
      <td>${s.region}</td>
      <td class="contacts">${contactFor(s)}</td>
      <td><span class="chip ${s.trusted ? "chip-green" : "chip-amber"}">${s.trusted ? "Confiable" : "Sin verificar"}</span></td>
    </tr>`).join("");
  $("tabla").innerHTML = suppliers.length === 0 ? "" : `
    <table><thead><tr>
      <th>Proveedor</th><th>Material</th><th>Mayoreo</th><th>Mín.</th><th>Región</th><th>Contacto</th><th>Estado</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function render(data) {
  $("total").textContent = `${data.suppliers.length} en el directorio`;
  renderBest(data.mejorOpcion);
  renderTable(data.suppliers);
}

async function cargarDirectorio() {
  const region = $("region").value.trim() || "global";
  const res = await fetch(`/api/directorio?region=${encodeURIComponent(region)}`);
  const data = await res.json();
  render({ suppliers: data.suppliers, mejorOpcion: null });
}

$("buscar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = $("query").value.trim();
  const region = $("region").value.trim() || "global";
  if (!query) return;
  $("status").textContent = "Buscando proveedores…";
  try {
    const res = await fetch("/api/buscar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, region }),
    });
    const data = await res.json();
    if (!data.ok) { $("status").textContent = data.error ?? "Error en la búsqueda."; return; }
    render(data);
    $("status").textContent = `${data.nuevos} nuevos · ${data.total} en total`;
  } catch {
    $("status").textContent = "No se pudo completar la búsqueda.";
  }
});

cargarDirectorio();
```

- [ ] **Step 4: Commit**

```bash
rtk git add web/ && rtk git commit -m "feat: frontend del directorio (maqueta aprobada, vanilla)"
```

---

## Task 11: Entry del servidor + estáticos + verificación end-to-end

Arma las dependencias reales (cliente Anthropic desde env, funciones de store, path del directorio) y sirve la API + los archivos de `web/`.

**Files:**
- Create: `src/server/index.ts`
- Modify: `.gitignore` (agregar `directorio.json`)

- [ ] **Step 1: `.gitignore` — ignorar el directorio de datos**

Agregar la línea:

```
directorio.json
```

- [ ] **Step 2: `src/server/index.ts`**

```ts
// Entry del servidor: arma dependencias reales y sirve API + estáticos de web/.

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import Anthropic from "@anthropic-ai/sdk";
import { loadDotenvIfPresent } from "../config/loadDotenv.js";
import { loadEnv } from "../config/env.js";
import { logger } from "../logging/logger.js";
import { createSupplierSource } from "../sourcing/supplierSource.js";
import { loadDirectory, saveDirectory } from "../directory/store.js";
import { buildApi } from "./api.js";

const PORT = 8787;
const DIRECTORY_PATH = "directorio.json";

loadDotenvIfPresent();
const env = loadEnv();

const client = new Anthropic({ apiKey: env.anthropicApiKey });
const app = buildApi({
  source: createSupplierSource({ client }),
  loadDirectory,
  saveDirectory,
  now: () => new Date().toISOString(),
  directoryPath: DIRECTORY_PATH,
});

// Servir el frontend estático desde web/.
app.get("/*", serveStatic({ root: "./web" }));

serve({ fetch: app.fetch, port: PORT }, () => {
  logger.info("servidor de proveedores escuchando", { url: `http://localhost:${PORT}` });
});
```

- [ ] **Step 3: Verificar checks completos**

Run: `rtk pnpm run typecheck && rtk pnpm run lint && rtk pnpm exec prettier --check src web && rtk pnpm test`
Expected: todo verde. Si hay drift de formato: `rtk pnpm exec prettier --write src web` y volver a correr.

- [ ] **Step 4: Build**

Run: `rtk pnpm run build`
Expected: build OK, genera `dist/server/index.js`.

- [ ] **Step 5: Verificación manual end-to-end**

Con `ANTHROPIC_API_KEY` en `.env`:

Run: `node dist/server/index.js`
Luego abrir `http://localhost:8787`, buscar "láminas de metal galvanizadas" región `mx`, y confirmar:
- Aparecen proveedores con contacto y mejor opción destacada.
- El contador sube; una segunda búsqueda igual **no duplica** (merge).
- Se crea/actualiza `directorio.json`.

- [ ] **Step 6: Commit**

```bash
rtk git add src/server/index.ts .gitignore && rtk git commit -m "feat: entry del servidor + estáticos + gitignore de directorio.json"
```

---

## Notas de implementación

- **tsconfig `rootDir`:** hoy es `src`. El frontend vive en `web/` (no se compila con tsc; se sirve estático). No agregar `web/` a `include`.
- **Serve-static root:** `serveStatic({ root: "./web" })` sirve relativo al cwd donde corre `node`. Documentarlo: correr el server desde la raíz del repo.
- **Reuso vs duplicación:** `medianPrice`/`isPriceOutlier` de proveedores son análogos a los de retail (`src/compare`), pero operan sobre `wholesalePrice` opcional; se mantienen separados (dominios distintos) en vez de forzar una abstracción prematura.
- **Retail v1:** el CLI de retail (`src/cli`, `src/compare`, `src/sources`, `src/agent`) queda intacto y funcional; este plan no lo modifica.
