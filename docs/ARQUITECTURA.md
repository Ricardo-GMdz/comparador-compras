# Arquitectura — comparador-compras

CLI agente que, dado un producto, busca información y ofertas en internet, compara
precios entre proveedores, recomienda la mejor opción y sugiere upgrades dentro de
un rango de precio similar.

## Principios

- **Inmutabilidad**: ningún módulo muta objetos; siempre devuelve copias nuevas.
- **Errores explícitos**: se manejan en cada nivel; nunca se tragan en silencio.
  Validación en los límites (entrada del usuario, respuestas externas) con `zod`.
- **Archivos chicos y cohesivos**: 200-400 líneas típico, 800 máx.
- **Multi-región**: la región es un parámetro (`--region`) que condiciona moneda y
  tiendas. No se hardcodea ningún país; el default es `"global"`.
- **Naming**: `camelCase` (vars/funcs, con `is/has/should/can` para booleanos),
  `PascalCase` (tipos/interfaces), `UPPER_SNAKE_CASE` (constantes). Identificadores
  en inglés; comentarios en español.

## Stack

- TypeScript + Node, ESM (`"type": "module"`), package manager `pnpm`.
- Tooling: `vitest` (tests), `eslint` + `prettier`, `tsconfig` strict.
- SDK: `@anthropic-ai/sdk`, modelo `claude-opus-4-8`, adaptive thinking
  (`thinking: { type: "adaptive" }`). El agente usa tool use con el server tool
  `web_search` (type `"web_search_20260209"`, name `"web_search"`).
- Config: validación de entorno con `zod`. CLI con `commander`.
- CI: GitHub Actions (lint + typecheck + test).

## Flujo del primer slice vertical (end-to-end)

```
comparar "<producto>" --region <code>
  -> loadEnv()                      (valida ANTHROPIC_API_KEY con zod, falla rápido)
  -> createWebSearchSource({ apiKey })
  -> runComparison({ query, region, sources })
       -> source.search(product)   (web_search via @anthropic-ai/sdk)
       -> compareOffers(product, offers)
            -> normalizePrice / rankOffers
  -> ComparisonResult (>= 1 oferta normalizada)
  -> render de tabla en consola
```

## Módulos y contratos públicos

Estos contratos son la fuente de verdad. Las rutas y firmas son exactas; todos los
módulos deben encajar con ellos.

### `src/domain/types.ts`

```ts
export interface Provider {
  name: string;
  url?: string;
  trusted: boolean;
}
export interface Offer {
  productTitle: string;
  provider: Provider;
  priceAmount: number;
  currency: string;
  region: string;
  url?: string;
  raw?: string;
}
export interface Product {
  query: string;
  region: string;
}
export interface ComparisonResult {
  product: Product;
  offers: readonly Offer[];
  best?: Offer;
  upgradeSuggestion?: Offer;
  notes?: string;
}
```

### `src/domain/source.ts`

```ts
import type { Product, Offer } from "./types.js";
export interface ProductSource {
  readonly id: string;
  search(product: Product): Promise<readonly Offer[]>;
}
```

### `src/config/env.ts`

```ts
export interface Env {
  anthropicApiKey: string;
}
export function loadEnv(): Env; // valida con zod, falla rápido
```

### `src/logging/logger.ts`

```ts
export const logger; // logger estructurado simple: info/warn/error
```

### `src/sources/webSearchSource.ts`

```ts
export function createWebSearchSource(deps: { apiKey: string }): ProductSource;
// id "web-search"; usa @anthropic-ai/sdk con web_search
```

### `src/compare/index.ts`

```ts
export function normalizePrice(offer: Offer): Offer;
export function rankOffers(offers: readonly Offer[]): readonly Offer[];
export function compareOffers(product: Product, offers: readonly Offer[]): ComparisonResult;
```

### `src/agent/runner.ts`

```ts
export function runComparison(input: {
  query: string;
  region: string;
  sources: readonly ProductSource[];
}): Promise<ComparisonResult>;
```

### `src/cli/index.ts`

```ts
export function buildProgram(): import("commander").Command;
// comando "comparar <producto>" con opción --region, default "global"
```

### `src/index.ts`

Bin entry: parsea `argv` y ejecuta el program.

## Diagrama de dependencias (alto nivel)

```
index.ts
  └─ cli/index.ts (buildProgram)
       └─ agent/runner.ts (runComparison)
            ├─ domain/source.ts (ProductSource)
            │    └─ sources/webSearchSource.ts (createWebSearchSource)
            │         └─ config/env.ts (loadEnv) + @anthropic-ai/sdk
            └─ compare/index.ts (compareOffers, rankOffers, normalizePrice)
  (transversal) logging/logger.ts
  (transversal) domain/types.ts
```

## Estado de los cimientos

Este andamiaje crea la configuración del proyecto (package.json, tsconfig, eslint,
prettier, vitest, CI, .env.example) y los contratos de dominio (`types.ts`,
`source.ts`). Los módulos `config`, `logging`, `sources`, `compare`, `agent` y `cli`
los implementan otros agentes respetando los contratos de arriba.
