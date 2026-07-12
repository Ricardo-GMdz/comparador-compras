# Deploy funcional a Vercel Hobby — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poner la app de sourcing funcional en una URL pública de Vercel (plan Hobby, gratis), protegida con una clave compartida, con el directorio persistido en Upstash Redis y la búsqueda acotada para caber en el límite de 60 s.

**Architecture:** No se toca la lógica de negocio (`buildApi`, ranking, dominio). Se agregan dependencias inyectables nuevas: un store de Redis que implementa el mismo contrato que el store de archivo, un presupuesto de búsqueda opcional en el sourcing, y un middleware de clave de acceso montado solo en el entry de Vercel. El entry local sigue idéntico. Spec: `docs/superpowers/specs/2026-07-12-deploy-vercel-design.md`.

**Tech Stack:** TypeScript/Node ESM, Hono, `hono/vercel` (adapter), `@upstash/redis`, zod, vitest. Sin cambios de runtime en el server local.

**Convenciones para TODAS las tareas:** TDD (test primero → correr y ver FALLAR → implementar → correr y ver PASAR → commit). Comandos con prefijo `rtk`. Comentarios en español, identificadores en inglés. Inmutabilidad. Después de cada tarea con código: `rtk pnpm run typecheck && rtk pnpm run lint && rtk pnpm test` en verde antes del commit. Rama de trabajo: `feat/deploy-vercel` (ya creada).

**Contratos nuevos (fuente de verdad):**

```ts
// directory/store.ts  — exportar el schema para reusarlo en Redis
export const directorySchema: z.ZodType<Supplier[]>;

// directory/redisStore.ts
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}
export function createRedisStore(redis: RedisLike): {
  loadDirectory: (path: string) => Promise<readonly Supplier[]>;      // ignora `path`, usa clave fija
  saveDirectory: (path: string, suppliers: readonly Supplier[]) => Promise<void>;
  loadPublicDirectory: () => Promise<readonly PublicSupplier[]>;
  savePublicDirectory: (suppliers: readonly PublicSupplier[]) => Promise<void>;
};

// sourcing/supplierSource.ts  — presupuesto opcional (sin él, comportamiento actual)
export interface SearchBudget {
  maxWebSearchUses: number;
  maxEmptyRetries: number;
  maxTokens: number;
  thinkingBudgetTokens?: number; // presente → thinking "enabled" acotado; ausente → "adaptive"
}
export interface SupplierSourceDeps {
  client: Anthropic;
  localidad?: string;
  searchBudget?: SearchBudget; // NUEVO
}

// server/auth.ts
export const COOKIE_NAME = "cc_auth";
export function hashEqual(a: string, b: string): boolean;         // comparación en tiempo constante
export function makeToken(expMs: number, secret: string): string;
export function verifyToken(token: string | undefined, secret: string, nowMs: number): boolean;

// server/api.ts  — ApiDeps gana:
//   loadPublicDirectory: () => Promise<readonly PublicSupplier[]>;   (requerido)
//   auth?: { accessKey: string; now?: () => number };                (opcional; presente = protegido)

// config/vercelEnv.ts
export interface VercelEnv {
  anthropicApiKey: string;
  accessKey: string;
  upstashUrl: string;
  upstashToken: string;
  sourcingLocalidad?: string;
}
export function loadVercelEnv(): VercelEnv;
```

---

## Task 1: Exportar el schema del directorio + store de Redis

**Files:**
- Modify: `src/directory/store.ts` (exportar `directorySchema`)
- Create: `src/directory/redisStore.ts`
- Test: `src/directory/redisStore.test.ts`

- [ ] **Step 1: Exportar el schema en `store.ts`**

En `src/directory/store.ts`, cambiar la declaración (línea ~166) de:

```ts
const directorySchema = z.array(supplierSchema);
```

a:

```ts
export const directorySchema = z.array(supplierSchema);
```

- [ ] **Step 2: Escribir el test que falla**

Crear `src/directory/redisStore.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createRedisStore, type RedisLike } from "./redisStore.js";
import type { Supplier } from "../domain/supplier.js";
import type { PublicSupplier } from "./publicDirectory.js";

const NOW = "2026-07-01T00:00:00.000Z";

function makeSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    name: "Aceros",
    material: "lámina",
    region: "mx",
    trusted: true,
    contact: {},
    status: "pendiente",
    firstSeen: NOW,
    lastSeen: NOW,
    ...overrides,
  };
}

/** Redis en memoria para el test (implementa RedisLike). */
function fakeRedis(seed: Record<string, string> = {}): RedisLike & { data: Record<string, string> } {
  const data: Record<string, string> = { ...seed };
  return {
    data,
    async get(key: string) {
      return key in data ? data[key] : null;
    },
    async set(key: string, value: string) {
      data[key] = value;
    },
  };
}

describe("redisStore", () => {
  it("loadDirectory devuelve [] cuando la clave no existe", async () => {
    const store = createRedisStore(fakeRedis());
    expect(await store.loadDirectory("x")).toEqual([]);
  });

  it("hace round-trip save → load del directorio", async () => {
    const redis = fakeRedis();
    const store = createRedisStore(redis);
    const suppliers = [makeSupplier({ name: "Uno" }), makeSupplier({ name: "Dos" })];
    await store.saveDirectory("x", suppliers);
    expect(await store.loadDirectory("x")).toEqual(suppliers);
  });

  it("valida con zod y migra un supplier sin status a 'pendiente'", async () => {
    const legacy = JSON.stringify([
      { name: "Viejo", material: "m", region: "mx", trusted: false, contact: {}, firstSeen: NOW, lastSeen: NOW },
    ]);
    const store = createRedisStore(fakeRedis({ directorio: legacy }));
    const loaded = await store.loadDirectory("x");
    expect(loaded[0]?.status).toBe("pendiente");
  });

  it("lanza error explícito si el JSON está corrupto", async () => {
    const store = createRedisStore(fakeRedis({ directorio: "no-es-json{" }));
    await expect(store.loadDirectory("x")).rejects.toThrow();
  });

  it("hace round-trip del directorio público", async () => {
    const redis = fakeRedis();
    const store = createRedisStore(redis);
    const publicos: PublicSupplier[] = [
      { name: "Pub", material: "m", region: "mx", contact: {}, trusted: true, status: "contactado" },
    ];
    await store.savePublicDirectory(publicos);
    expect(await store.loadPublicDirectory()).toEqual(publicos);
  });

  it("loadPublicDirectory devuelve [] cuando no hay nada publicado", async () => {
    const store = createRedisStore(fakeRedis());
    expect(await store.loadPublicDirectory()).toEqual([]);
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `rtk pnpm exec vitest run src/directory/redisStore.test.ts`
Expected: FAIL — `Cannot find module './redisStore.js'`.

- [ ] **Step 4: Implementar `redisStore.ts`**

Crear `src/directory/redisStore.ts`:

```ts
// Store del directorio respaldado por Redis (Upstash). Implementa el mismo
// contrato que el store de archivo, reusando la validación zod. La identidad
// de la clave no depende del `path` (se conserva la firma por compatibilidad).

import { directorySchema } from "./store.js";
import type { Supplier } from "../domain/supplier.js";
import type { PublicSupplier } from "./publicDirectory.js";

/** Interfaz mínima de Redis que necesitamos (inyectable para tests). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

// Claves fijas en Redis. El directorio privado y el público viven separados.
const DIRECTORY_KEY = "directorio";
const PUBLIC_KEY = "directorio-publico";

/** Crea un store del directorio sobre un cliente Redis. */
export function createRedisStore(redis: RedisLike) {
  async function loadDirectory(_path: string): Promise<readonly Supplier[]> {
    const raw = await redis.get(DIRECTORY_KEY);
    if (raw === null) {
      return [];
    }
    // Validamos con el MISMO schema que el store de archivo (dato externo).
    return directorySchema.parse(JSON.parse(raw));
  }

  async function saveDirectory(_path: string, suppliers: readonly Supplier[]): Promise<void> {
    await redis.set(DIRECTORY_KEY, JSON.stringify(suppliers));
  }

  async function loadPublicDirectory(): Promise<readonly PublicSupplier[]> {
    const raw = await redis.get(PUBLIC_KEY);
    if (raw === null) {
      return [];
    }
    return JSON.parse(raw) as PublicSupplier[];
  }

  async function savePublicDirectory(suppliers: readonly PublicSupplier[]): Promise<void> {
    await redis.set(PUBLIC_KEY, JSON.stringify(suppliers));
  }

  return { loadDirectory, saveDirectory, loadPublicDirectory, savePublicDirectory };
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `rtk pnpm exec vitest run src/directory/redisStore.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Checks + commit**

```bash
rtk pnpm run typecheck && rtk pnpm run lint && rtk pnpm test
rtk git add src/directory/store.ts src/directory/redisStore.ts src/directory/redisStore.test.ts
rtk git commit -m "feat: store del directorio respaldado por Redis (Upstash)"
```

---

## Task 2: Presupuesto de búsqueda acotado en el sourcing

**Files:**
- Modify: `src/sourcing/supplierSource.ts`
- Test: `src/sourcing/supplierSource.test.ts` (agregar casos)

- [ ] **Step 1: Escribir el test que falla**

Agregar a `src/sourcing/supplierSource.test.ts` (dentro del `describe` existente; si el archivo no tiene helpers de mock del cliente, usar este bloque autocontenido):

```ts
import { describe, it, expect, vi } from "vitest";
import { createSupplierSource } from "./supplierSource.js";

// Cliente Anthropic mockeado: captura los argumentos de messages.create.
function fakeClient(text: string) {
  const create = vi.fn(async () => ({ content: [{ type: "text", text }] }));
  return { client: { messages: { create } } as never, create };
}

describe("createSupplierSource — searchBudget", () => {
  const emptyJson = JSON.stringify({ suppliers: [] });

  it("sin searchBudget usa los defaults (adaptive, 5 usos, 1 reintento)", async () => {
    const { client, create } = fakeClient(emptyJson);
    const source = createSupplierSource({ client });
    await source.search({ query: "láminas", region: "mx" });
    // Vacío + default → reintenta: 2 llamadas.
    expect(create).toHaveBeenCalledTimes(2);
    const args = create.mock.calls[0][0];
    expect(args.thinking).toEqual({ type: "adaptive" });
    expect(args.tools[0].max_uses).toBe(5);
  });

  it("con searchBudget acota usos/thinking y NO reintenta si maxEmptyRetries=0", async () => {
    const { client, create } = fakeClient(emptyJson);
    const source = createSupplierSource({
      client,
      searchBudget: { maxWebSearchUses: 2, maxEmptyRetries: 0, maxTokens: 8000, thinkingBudgetTokens: 2000 },
    });
    await source.search({ query: "láminas", region: "mx" });
    // maxEmptyRetries=0 → una sola llamada aunque venga vacío.
    expect(create).toHaveBeenCalledTimes(1);
    const args = create.mock.calls[0][0];
    expect(args.thinking).toEqual({ type: "enabled", budget_tokens: 2000 });
    expect(args.max_tokens).toBe(8000);
    expect(args.tools[0].max_uses).toBe(2);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `rtk pnpm exec vitest run src/sourcing/supplierSource.test.ts -t searchBudget`
Expected: FAIL — el segundo test falla (hoy siempre usa adaptive/5/retry).

- [ ] **Step 3: Implementar el presupuesto**

En `src/sourcing/supplierSource.ts`:

3a. Agregar la interfaz y el campo en deps (después de `SupplierQuery`, ~línea 26):

```ts
/** Presupuesto opcional para acotar la búsqueda (deploy con límite de tiempo). */
export interface SearchBudget {
  maxWebSearchUses: number;
  maxEmptyRetries: number;
  maxTokens: number;
  /** Si está presente, thinking pasa a "enabled" con este budget; si no, "adaptive". */
  thinkingBudgetTokens?: number;
}
```

3b. Extender `SupplierSourceDeps`:

```ts
export interface SupplierSourceDeps {
  client: Anthropic;
  /** Localidad prioritaria del usuario (ej. "San Nicolás de los Garza, NL"). */
  localidad?: string;
  /** Acota la búsqueda para caber en un límite de tiempo (sin él: sin recortes). */
  searchBudget?: SearchBudget;
}
```

3c. Dentro de `createSupplierSource`, al inicio de la función (antes de `searchOnce`), resolver los valores efectivos:

```ts
  const maxWebSearchUses = deps.searchBudget?.maxWebSearchUses ?? MAX_WEB_SEARCH_USES;
  const maxEmptyRetries = deps.searchBudget?.maxEmptyRetries ?? MAX_EMPTY_RETRIES;
  const maxTokens = deps.searchBudget?.maxTokens ?? MAX_TOKENS;
  const thinking =
    deps.searchBudget?.thinkingBudgetTokens !== undefined
      ? ({ type: "enabled", budget_tokens: deps.searchBudget.thinkingBudgetTokens } as const)
      : ({ type: "adaptive" } as const);
```

3d. En `searchOnce`, reemplazar en el `messages.create`:
- `max_tokens: MAX_TOKENS,` → `max_tokens: maxTokens,`
- `thinking: { type: "adaptive" },` → `thinking,`
- `max_uses: MAX_WEB_SEARCH_USES` → `max_uses: maxWebSearchUses`

3e. En `search`, reemplazar las dos referencias a `MAX_EMPTY_RETRIES` por la local `maxEmptyRetries`:

```ts
  async function search(q: SupplierQuery): Promise<readonly SupplierCandidate[]> {
    for (let attempt = 0; attempt <= maxEmptyRetries; attempt += 1) {
      const candidates = await searchOnce(q);
      if (candidates.length > 0) {
        return candidates;
      }
      if (attempt < maxEmptyRetries) {
        logger.warn("sourcing: búsqueda sin proveedores, reintentando", {
          query: q.query,
          region: q.region,
          attempt: attempt + 1,
        });
      }
    }
    return [];
  }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `rtk pnpm exec vitest run src/sourcing/supplierSource.test.ts`
Expected: PASS (los nuevos + los existentes del archivo).

- [ ] **Step 5: Checks + commit**

```bash
rtk pnpm run typecheck && rtk pnpm run lint && rtk pnpm test
rtk git add src/sourcing/supplierSource.ts src/sourcing/supplierSource.test.ts
rtk git commit -m "feat: searchBudget opcional para acotar la búsqueda en deploy"
```

---

## Task 3: Helpers de clave de acceso (firma y verificación de token)

**Files:**
- Create: `src/server/auth.ts`
- Test: `src/server/auth.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/server/auth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashEqual, makeToken, verifyToken } from "./auth.js";

const SECRET = "clave-super-secreta";
const NOW = 1_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe("auth", () => {
  it("hashEqual: true para iguales, false para distintos", () => {
    expect(hashEqual("abc", "abc")).toBe(true);
    expect(hashEqual("abc", "abd")).toBe(false);
    expect(hashEqual("corta", "muchisimo-mas-larga")).toBe(false);
  });

  it("verifyToken acepta un token recién emitido y no vencido", () => {
    const token = makeToken(NOW + 30 * DAY, SECRET);
    expect(verifyToken(token, SECRET, NOW)).toBe(true);
  });

  it("verifyToken rechaza token vencido", () => {
    const token = makeToken(NOW - 1, SECRET);
    expect(verifyToken(token, SECRET, NOW)).toBe(false);
  });

  it("verifyToken rechaza firma con secreto distinto", () => {
    const token = makeToken(NOW + DAY, SECRET);
    expect(verifyToken(token, "otro-secreto", NOW)).toBe(false);
  });

  it("verifyToken rechaza token adulterado o ausente", () => {
    expect(verifyToken(undefined, SECRET, NOW)).toBe(false);
    expect(verifyToken("", SECRET, NOW)).toBe(false);
    expect(verifyToken("basura-sin-punto", SECRET, NOW)).toBe(false);
    const token = makeToken(NOW + DAY, SECRET);
    expect(verifyToken(token + "x", SECRET, NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `rtk pnpm exec vitest run src/server/auth.test.ts`
Expected: FAIL — `Cannot find module './auth.js'`.

- [ ] **Step 3: Implementar `auth.ts`**

Crear `src/server/auth.ts`:

```ts
// Clave de acceso compartida: firma/verificación de una cookie de sesión.
// Sin usuarios ni base: una sola clave (ACCESS_KEY) para un círculo de confianza.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Nombre de la cookie de sesión. */
export const COOKIE_NAME = "cc_auth";

/** Rutas que NO exige clave (login y directorio público). */
export const PUBLIC_PATHS: ReadonlySet<string> = new Set(["/api/login", "/api/publico"]);

/** Compara dos strings en tiempo constante (hashea a largo fijo antes). */
export function hashEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Firma HMAC del vencimiento con el secreto compartido. */
function sign(expMs: number, secret: string): string {
  return createHmac("sha256", secret).update(String(expMs)).digest("hex");
}

/** Arma el token `exp.firma`. */
export function makeToken(expMs: number, secret: string): string {
  return `${expMs}.${sign(expMs, secret)}`;
}

/** Verifica firma y vencimiento del token. */
export function verifyToken(
  token: string | undefined,
  secret: string,
  nowMs: number,
): boolean {
  if (!token) {
    return false;
  }
  const dot = token.indexOf(".");
  if (dot <= 0) {
    return false;
  }
  const exp = Number(token.slice(0, dot));
  const signature = token.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < nowMs) {
    return false;
  }
  return hashEqual(signature, sign(exp, secret));
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `rtk pnpm exec vitest run src/server/auth.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Checks + commit**

```bash
rtk pnpm run typecheck && rtk pnpm run lint && rtk pnpm test
rtk git add src/server/auth.ts src/server/auth.test.ts
rtk git commit -m "feat: firma/verificación de la cookie de clave de acceso"
```

---

## Task 4: Montar auth + endpoint público en la API

**Files:**
- Modify: `src/server/api.ts`
- Test: `src/server/api.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Primero actualizar el helper `fakeDeps` en `src/server/api.test.ts` para incluir `loadPublicDirectory` (la nueva dep requerida). En el objeto `deps` de `fakeDeps` (después de `savePublicDirectory`), agregar:

```ts
      loadPublicDirectory: vi.fn(async () => published.current ?? []),
```

Luego agregar este bloque de tests al final del archivo (antes del cierre del `describe` raíz o como `describe` nuevo):

```ts
describe("API — auth y público", () => {
  const NOW_MS = 5_000_000;

  it("sin cookie, una ruta protegida responde 401", async () => {
    const { deps } = fakeDeps();
    const app = buildApi({ ...deps, auth: { accessKey: "secreta", now: () => NOW_MS } });
    const res = await app.request("/api/directorio");
    expect(res.status).toBe(401);
  });

  it("login con clave correcta setea cookie y habilita el acceso", async () => {
    const { deps } = fakeDeps();
    const app = buildApi({ ...deps, auth: { accessKey: "secreta", now: () => NOW_MS } });

    const login = await app.request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "secreta" }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("cc_auth=");

    const jar = cookie.split(";")[0];
    const ok = await app.request("/api/directorio", { headers: { cookie: jar } });
    expect(ok.status).toBe(200);
  });

  it("login con clave incorrecta responde 401 sin cookie", async () => {
    const { deps } = fakeDeps();
    const app = buildApi({ ...deps, auth: { accessKey: "secreta", now: () => NOW_MS } });
    const res = await app.request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "incorrecta" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("GET /api/publico responde sin clave, con CORS, y solo campos públicos", async () => {
    const { deps } = fakeDeps();
    deps.loadPublicDirectory = vi.fn(async () => [
      { name: "Pub", material: "m", region: "mx", contact: {}, trusted: true, status: "contactado" },
    ]);
    const app = buildApi({ ...deps, auth: { accessKey: "secreta", now: () => NOW_MS } });
    const res = await app.request("/api/publico");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body[0]?.name).toBe("Pub");
    expect(body[0]).not.toHaveProperty("notes");
  });

  it("sin auth (entry local) las rutas no exigen cookie", async () => {
    const { deps } = fakeDeps();
    const app = buildApi(deps); // sin `auth`
    const res = await app.request("/api/directorio");
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `rtk pnpm exec vitest run src/server/api.test.ts -t "auth y público"`
Expected: FAIL — `auth`/`/api/publico` no existen aún.

- [ ] **Step 3: Implementar en `api.ts`**

3a. Agregar imports arriba:

```ts
import { getCookie, setCookie } from "hono/cookie";
import { COOKIE_NAME, PUBLIC_PATHS, hashEqual, makeToken, verifyToken } from "./auth.js";
```

3b. Extender `ApiDeps` (agregar dentro de la interfaz):

```ts
  /** Lee el directorio público (para /api/publico). */
  loadPublicDirectory: () => Promise<readonly PublicSupplier[]>;
  /** Si está presente, todas las rutas /api exigen la clave (menos login/publico). */
  auth?: { accessKey: string; now?: () => number };
```

3c. Agregar la constante de duración de sesión cerca de los otros consts del módulo:

```ts
// Duración de la cookie de sesión: 30 días.
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
```

3d. Al inicio de `buildApi`, justo después de `const app = new Hono();`, montar auth y login SOLO si `deps.auth` está presente. Debe ir ANTES de registrar las rutas protegidas:

```ts
  if (deps.auth !== undefined) {
    const { accessKey } = deps.auth;
    const now = deps.auth.now ?? (() => Date.now());

    // Middleware: exige cookie válida en /api/* (menos login y público).
    app.use("*", async (c, next) => {
      const path = new URL(c.req.url).pathname;
      if (!path.startsWith("/api/") || PUBLIC_PATHS.has(path)) {
        return next();
      }
      if (verifyToken(getCookie(c, COOKIE_NAME), accessKey, now())) {
        return next();
      }
      return c.json({ ok: false, error: "No autorizado. Ingresá la clave de acceso." }, 401);
    });

    app.post("/api/login", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { key?: unknown };
      const key = typeof body.key === "string" ? body.key : "";
      if (!hashEqual(key, accessKey)) {
        return c.json({ ok: false, error: "Clave incorrecta." }, 401);
      }
      const exp = now() + SESSION_MS;
      setCookie(c, COOKIE_NAME, makeToken(exp, accessKey), {
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        maxAge: SESSION_MS / 1000,
        path: "/",
      });
      return c.json({ ok: true });
    });
  }
```

3e. Agregar el endpoint público (sin clave). Ubicarlo junto a las otras rutas GET, por ejemplo después de `/api/directorio.csv`:

```ts
  // Directorio público (sin clave): la landing lo consume. CORS abierto a propósito.
  app.get("/api/publico", async (c) => {
    const publicSuppliers = await deps.loadPublicDirectory();
    return c.json(publicSuppliers, 200, { "access-control-allow-origin": "*" });
  });
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `rtk pnpm exec vitest run src/server/api.test.ts`
Expected: PASS (los nuevos + todos los existentes del archivo).

- [ ] **Step 5: Checks + commit**

```bash
rtk pnpm run typecheck && rtk pnpm run lint && rtk pnpm test
rtk git add src/server/api.ts src/server/api.test.ts
rtk git commit -m "feat: middleware de clave de acceso y endpoint público en la API"
```

---

## Task 5: Pantalla de clave en el frontend + manejo de 401

**Files:**
- Modify: `web/index.html`
- Modify: `web/app.js`

Nota: `web/` no tiene tests automatizados (es vanilla servido estático); esta tarea se verifica manualmente al final (Task 10). Aun así, cada cambio se commitea aparte.

- [ ] **Step 1: Agregar el overlay de login en `web/index.html`**

Dentro de `<main class="wrap">`, como primer hijo (antes de `<header class="topbar">`), agregar:

```html
      <div id="login" class="login-overlay hidden">
        <form id="loginForm" class="login-card">
          <h2>Clave de acceso</h2>
          <p class="login-hint">Esta app consume tokens; ingresá la clave compartida.</p>
          <input id="loginKey" class="input" type="password" placeholder="Clave" autocomplete="current-password" />
          <button class="btn" type="submit">Entrar</button>
          <div id="loginError" class="login-error"></div>
        </form>
      </div>
```

- [ ] **Step 2: Estilos mínimos del overlay en `web/styles.css`**

Agregar al final de `web/styles.css`:

```css
/* Overlay de clave de acceso */
.login-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.75);
  z-index: 50;
}
.login-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 280px;
  padding: 28px;
  border-radius: 14px;
  background: var(--panel, #fff);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
}
.login-hint {
  margin: 0;
  font-size: 13px;
  opacity: 0.7;
}
.login-error {
  min-height: 18px;
  font-size: 13px;
  color: #dc2626;
}
```

- [ ] **Step 3: Envolver los fetch de la API con un helper que detecta 401**

En `web/app.js`, agregar cerca del tope (después de `const $ = ...`):

```js
// Wrapper de fetch a la API: ante 401 muestra la pantalla de clave y corta el flujo.
async function apiFetch(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    mostrarLogin();
    throw new Error("no-autorizado");
  }
  return res;
}

function mostrarLogin() {
  $("login").classList.remove("hidden");
  $("loginKey").focus();
}

function ocultarLogin() {
  $("login").classList.add("hidden");
}
```

- [ ] **Step 4: Usar `apiFetch` en todas las llamadas a la API**

En `web/app.js`, reemplazar cada `fetch("/api/...")` o `` fetch(`/api/...`) `` por `apiFetch(...)` en estas funciones: `cargarDirectorio`, `patchProveedor`, `borrarProveedor`, `enriquecerProveedor`, `generarMensaje`, el handler de `$("buscar").addEventListener(...)`, y el handler de `$("publicar").addEventListener(...)`. (Son 7 call sites; la firma es idéntica, solo cambia el nombre de la función.)

En los `catch` de esas funciones, ignorar el error sentinela para no pisar el mensaje del overlay:

```js
  } catch (e) {
    if (e && e.message === "no-autorizado") return;
    $("status").textContent = "No se pudo completar la búsqueda.";
  }
```

(Aplicar el mismo patrón `if (e && e.message === "no-autorizado") return;` al inicio de cada `catch` correspondiente.)

- [ ] **Step 5: Wire del formulario de login**

Agregar en la sección de eventos de `web/app.js`:

```js
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = $("loginKey").value;
  $("loginError").textContent = "";
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) {
      $("loginError").textContent = "Clave incorrecta.";
      return;
    }
    ocultarLogin();
    $("loginKey").value = "";
    await cargarDirectorio();
  } catch {
    $("loginError").textContent = "No se pudo verificar la clave.";
  }
});
```

- [ ] **Step 6: Ajustar el mensaje de "Publicar" (ya no es un archivo a commitear)**

En el handler de `$("publicar")`, reemplazar el texto de éxito por:

```js
    $("status").textContent = `${data.publicados} proveedores publicados — ya visibles en la landing.`;
```

- [ ] **Step 7: Verificación local rápida + commit**

```bash
rtk pnpm run build && rtk pnpm run serve
```
Abrir `http://localhost:8787` — la app carga normal (el entry local no exige clave, así que el overlay NO aparece). Cortar el server (Ctrl-C).

```bash
rtk git add web/index.html web/styles.css web/app.js
rtk git commit -m "feat: pantalla de clave de acceso y manejo de 401 en el frontend"
```

---

## Task 6: Loader de entorno para Vercel

**Files:**
- Create: `src/config/vercelEnv.ts`
- Test: `src/config/vercelEnv.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/config/vercelEnv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadVercelEnv } from "./vercelEnv.js";

const BASE = {
  ANTHROPIC_API_KEY: "sk-test",
  ACCESS_KEY: "clave",
  UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "tok",
};

describe("loadVercelEnv", () => {
  it("devuelve el env validado con todos los campos", () => {
    const env = loadVercelEnv({ ...BASE, SOURCING_LOCALIDAD: "Monterrey" });
    expect(env).toEqual({
      anthropicApiKey: "sk-test",
      accessKey: "clave",
      upstashUrl: "https://x.upstash.io",
      upstashToken: "tok",
      sourcingLocalidad: "Monterrey",
    });
  });

  it("localidad es opcional", () => {
    const env = loadVercelEnv(BASE);
    expect(env.sourcingLocalidad).toBeUndefined();
  });

  it("falla con mensaje claro si falta ACCESS_KEY", () => {
    const { ACCESS_KEY: _omit, ...sinClave } = BASE;
    expect(() => loadVercelEnv(sinClave)).toThrow(/ACCESS_KEY/);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `rtk pnpm exec vitest run src/config/vercelEnv.test.ts`
Expected: FAIL — `Cannot find module './vercelEnv.js'`.

- [ ] **Step 3: Implementar `vercelEnv.ts`**

Crear `src/config/vercelEnv.ts`:

```ts
// Configuración de entorno para el deploy en Vercel: valida con zod las
// variables extra (clave de acceso + Redis) además de la API key de Anthropic.
// Separado de config/env.ts para NO exigir estas variables en el entry local.

import { z } from "zod";

/** Variables de entorno validadas del deploy en Vercel. */
export interface VercelEnv {
  anthropicApiKey: string;
  accessKey: string;
  upstashUrl: string;
  upstashToken: string;
  sourcingLocalidad?: string;
}

const required = (name: string) =>
  z.string({ message: `Falta la variable de entorno ${name}` }).trim().min(1, {
    message: `${name} no puede estar vacía`,
  });

const schema = z.object({
  ANTHROPIC_API_KEY: required("ANTHROPIC_API_KEY"),
  ACCESS_KEY: required("ACCESS_KEY"),
  UPSTASH_REDIS_REST_URL: required("UPSTASH_REDIS_REST_URL"),
  UPSTASH_REDIS_REST_TOKEN: required("UPSTASH_REDIS_REST_TOKEN"),
  SOURCING_LOCALIDAD: z.string().optional(),
});

/** Carga y valida el entorno de Vercel (por defecto lee de `process.env`). */
export function loadVercelEnv(source: NodeJS.ProcessEnv = process.env): VercelEnv {
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((i) => i.message).join("; ");
    throw new Error(`Configuración de entorno inválida: ${details}`);
  }
  const localidad = result.data.SOURCING_LOCALIDAD?.trim();
  return {
    anthropicApiKey: result.data.ANTHROPIC_API_KEY,
    accessKey: result.data.ACCESS_KEY,
    upstashUrl: result.data.UPSTASH_REDIS_REST_URL,
    upstashToken: result.data.UPSTASH_REDIS_REST_TOKEN,
    ...(localidad !== undefined && localidad.length > 0 ? { sourcingLocalidad: localidad } : {}),
  };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `rtk pnpm exec vitest run src/config/vercelEnv.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Checks + commit**

```bash
rtk pnpm run typecheck && rtk pnpm run lint && rtk pnpm test
rtk git add src/config/vercelEnv.ts src/config/vercelEnv.test.ts
rtk git commit -m "feat: loader de entorno para el deploy en Vercel"
```

---

## Task 7: Entry de Vercel + configuración + dependencias

**Files:**
- Modify: `package.json` (dependencias)
- Create: `api/index.ts`
- Create: `vercel.json`

Nota: esta tarea es de wiring/configuración; no lleva test unitario (se verifica en el deploy, Task 10). Igual debe pasar `typecheck`/`build`.

- [ ] **Step 1: Agregar dependencias**

```bash
rtk pnpm add @upstash/redis
```

`hono` ya está instalado (trae `hono/vercel` y `hono/cookie`).

- [ ] **Step 2: Crear el entry `api/index.ts`**

Crear `api/index.ts`:

```ts
// Entry para Vercel: arma la app con dependencias de nube (Redis + clave de
// acceso + búsqueda acotada) y la expone como función serverless Node.
// El límite del plan Hobby es 60 s: la búsqueda corre acotada para caber.

import { handle } from "hono/vercel";
import { Redis } from "@upstash/redis";
import Anthropic from "@anthropic-ai/sdk";
import { loadVercelEnv } from "../src/config/vercelEnv.js";
import { createSupplierSource, type SearchBudget } from "../src/sourcing/supplierSource.js";
import { createRedisStore } from "../src/directory/redisStore.js";
import { buildApi } from "../src/server/api.js";

export const runtime = "nodejs";
export const maxDuration = 60;

// Presupuesto acotado para caber en 60 s (afinable midiendo en producción).
const VERCEL_SEARCH_BUDGET: SearchBudget = {
  maxWebSearchUses: 2,
  maxEmptyRetries: 0,
  maxTokens: 8000,
  thinkingBudgetTokens: 2000,
};

const env = loadVercelEnv();

const redis = new Redis({ url: env.upstashUrl, token: env.upstashToken });
// Upstash devuelve objetos ya deserializados; forzamos string para reusar el
// parseo zod del store (que espera texto JSON).
const redisLike = {
  get: (key: string) => redis.get<string>(key).then((v) => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v))),
  set: (key: string, value: string) => redis.set(key, value),
};
const store = createRedisStore(redisLike);

const client = new Anthropic({ apiKey: env.anthropicApiKey });
const app = buildApi({
  source: createSupplierSource({
    client,
    localidad: env.sourcingLocalidad,
    searchBudget: VERCEL_SEARCH_BUDGET,
  }),
  loadDirectory: store.loadDirectory,
  saveDirectory: store.saveDirectory,
  loadPublicDirectory: store.loadPublicDirectory,
  savePublicDirectory: store.savePublicDirectory,
  now: () => new Date().toISOString(),
  directoryPath: "directorio",
  auth: { accessKey: env.accessKey },
});

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
```

- [ ] **Step 3: Script de build que copia los estáticos + `vercel.json`**

Vercel sirve automáticamente lo que esté en `public/` en la raíz del dominio, y trata `api/*` como funciones. Como los estáticos viven en `web/`, el build los copia a `public/`.

Agregar el script en `package.json` (junto a `build`):

```json
"build:vercel": "tsc && rm -rf public && cp -r web public"
```

Crear `vercel.json` en la raíz:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "pnpm run build:vercel",
  "outputDirectory": "public",
  "functions": {
    "api/index.ts": { "maxDuration": 60 }
  },
  "rewrites": [{ "source": "/api/:path*", "destination": "/api/index" }]
}
```

Esto cumple: (a) `web/index.html`, `styles.css`, `app.js` quedan accesibles en la raíz vía `public/`; (b) cualquier `/api/*` se rutea a la función `api/index.ts` (el `rewrites` cubre las subrutas, que Vercel por sí solo no mapea).

> Nota para el implementador: los detalles de servido estáticos + función en Vercel pueden variar según la versión de la plataforma. Antes del deploy real, probá `vercel dev` localmente y ajustá `vercel.json`/`outputDirectory` si hiciera falta, hasta cumplir (a) y (b). No inventes rutas nuevas.

- [ ] **Step 4: Typecheck + build**

Run: `rtk pnpm run typecheck && rtk pnpm run build`
Expected: sin errores de tipos. (El build de `tsc` compila `api/` también si está bajo `include`; si `tsconfig` no incluye `api/`, agregarlo a `include`.)

- [ ] **Step 5: Commit**

```bash
rtk git add package.json pnpm-lock.yaml api/index.ts vercel.json tsconfig.json
rtk git commit -m "feat: entry de Vercel (Redis + clave + búsqueda acotada) y config de deploy"
```

---

## Task 8: La landing lee el directorio público desde Vercel

**Files:**
- Modify: `landing/index.html`

- [ ] **Step 1: Apuntar el fetch a la API pública de Vercel**

En `landing/index.html`, en el `<script>` del directorio público (~línea 591), reemplazar:

```js
        fetch("./proveedores.json")
```

por (usando una constante configurable al tope del bloque IIFE, ~línea 570, junto a los otros `var`):

```js
        // URL de la app en Vercel; se completa tras el deploy (Task 10).
        var API_PUBLICO = "https://REEMPLAZAR-CON-DOMINIO-VERCEL/api/publico";
```

y el fetch:

```js
        fetch(API_PUBLICO)
```

El resto del bloque (parseo, render de filas, `catch` que oculta la sección) queda igual: la forma de `PublicSupplier` es la misma que la del `proveedores.json`.

- [ ] **Step 2: Commit (con placeholder; se completa el dominio en Task 10)**

```bash
rtk git add landing/index.html
rtk git commit -m "feat: la landing lee el directorio público desde la API de Vercel"
```

---

## Task 9: Script de siembra del directorio en Redis

**Files:**
- Create: `scripts/seed-redis.ts`

Nota: script operativo de una sola corrida; sin test unitario. Siembra el `directorio.json` local en Redis.

- [ ] **Step 1: Crear `scripts/seed-redis.ts`**

```ts
// Siembra el directorio local (directorio.json) en Upstash Redis. Corrida única
// tras el primer deploy. Requiere UPSTASH_REDIS_REST_URL/TOKEN en el entorno.
// Uso: cargar las vars y correr con tsx/ts-node, o compilar y correr el JS.

import { readFile } from "node:fs/promises";
import { Redis } from "@upstash/redis";
import { directorySchema } from "../src/directory/store.js";
import { loadDotenvIfPresent } from "../src/config/loadDotenv.js";

async function main(): Promise<void> {
  loadDotenvIfPresent();
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("Faltan UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN en el entorno.");
  }

  const raw = await readFile("directorio.json", "utf8");
  const suppliers = directorySchema.parse(JSON.parse(raw)); // valida antes de subir
  const redis = new Redis({ url, token });
  await redis.set("directorio", JSON.stringify(suppliers));

  process.stdout.write(`Sembrados ${suppliers.length} proveedores en Redis (clave "directorio").\n`);
}

main().catch((error) => {
  process.stderr.write(`Error sembrando Redis: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Typecheck + commit**

```bash
rtk pnpm run typecheck
rtk git add scripts/seed-redis.ts
rtk git commit -m "chore: script de siembra del directorio en Redis"
```

---

## Task 10: Deploy a Vercel (pasos manuales del usuario + verificación)

Esta tarea combina acciones del usuario (crear recursos, pegar secretos) y de verificación. **Los secretos los ingresa el usuario en el dashboard de Vercel/Upstash — nunca se pegan en el chat ni se commitean.**

- [ ] **Step 1: Provisionar Upstash Redis**
  - Usuario: en el dashboard de Vercel → Storage → crear una base **Upstash Redis** (o crearla en upstash.com y conectarla). Vercel inyecta `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` como env vars del proyecto.

- [ ] **Step 2: Definir las variables de entorno del proyecto en Vercel**
  - Usuario carga en Vercel (Project → Settings → Environment Variables):
    - `ANTHROPIC_API_KEY` — la API key (la misma del `.env` local).
    - `ACCESS_KEY` — la clave compartida que elija el usuario (la que le pasará a sus socios).
    - `SOURCING_LOCALIDAD` — `San Nicolás de los Garza, Nuevo León (zona metropolitana de Monterrey)` (opcional).
    - Upstash: ya inyectadas por el Step 1 (verificar que estén).

- [ ] **Step 3: Conectar el repo y desplegar**
  - Usuario: importar el repo `Ricardo-GMdz/comparador-compras` en Vercel, rama `feat/deploy-vercel` (o mergear a `main` primero). Framework preset: **Other**. Build command / output según `vercel.json`.
  - Claude (si el usuario provee un token de Vercel CLI): `vercel --prod` desde la raíz; si no, el usuario aprieta Deploy en el dashboard.
  - Verificar el build en verde. Si falla por servido de estáticos, ajustar `vercel.json`/`outputDirectory` (ver nota de Task 7) y redeploy.

- [ ] **Step 4: Sembrar el directorio**
  - Con `UPSTASH_REDIS_REST_URL/TOKEN` disponibles localmente (el usuario los copia de Upstash a su `.env`), correr:
    ```bash
    rtk pnpm run build && node dist/scripts/seed-redis.js
    ```
    (o vía `pnpm exec tsx scripts/seed-redis.ts`). Debe imprimir "Sembrados N proveedores".

- [ ] **Step 5: Completar el dominio en la landing**
  - Tomar el dominio final de Vercel (ej. `comparador-xxxx.vercel.app`) y reemplazar `REEMPLAZAR-CON-DOMINIO-VERCEL` en `landing/index.html` (Task 8).
  - Commit + push a `main` para que GitHub Pages redeploye la landing.

- [ ] **Step 6: Verificación end-to-end (evidencia antes de declarar completo)**
  - `https://<app>.vercel.app` → aparece la app; al primer llamado, el overlay de clave.
  - Ingresar `ACCESS_KEY` → entra; el directorio muestra los 29 proveedores sembrados.
  - Hacer una búsqueda real (ej. "guantes de nitrilo") → vuelve dentro de 60 s con resultados (acotados) o error claro de timeout.
  - Marcar un proveedor como "contactado" → recargar la página → el cambio persiste (Redis).
  - Apretar "Publicar" → `https://<app>.vercel.app/api/publico` devuelve JSON con ese proveedor.
  - La landing de GitHub Pages muestra la sección "Proveedores trabajados" leyendo de Vercel.
  - Sin clave (ventana incógnito): `/api/directorio` responde 401; `/api/publico` responde 200.

- [ ] **Step 7: Cierre**
  - Actualizar `docs/ARQUITECTURA.md` con la sección de deploy (Vercel Hobby, Redis, clave, búsqueda acotada, endpoint público).
  - Actualizar la memoria del proyecto (`comparador-compras-direction.md`) con la URL pública funcional y el hecho de que el modo Vercel usa búsqueda acotada.
  - PR de `feat/deploy-vercel` → `main` (con el flujo de PRs del proyecto; el merge lo ordena el usuario).

---

## Notas de cierre

- **Trade-off central (documentado en el spec):** la búsqueda en Vercel es acotada (menos cobertura) para caber en 60 s; el modo local queda sin recortes. Si molesta, evaluar Railway/Fly o Vercel Pro (fuera de alcance).
- **Concurrencia:** last-write-wins sobre el JSON completo del directorio; aceptable para 2-3 usuarios de confianza.
- **Seguridad:** `ACCESS_KEY` es la única barrera de gasto de tokens; la cookie es `HttpOnly`+`Secure`, firmada con HMAC, 30 días. Nada de secretos en el repo.
