// Entry para Vercel: arma la app con dependencias de nube (Redis + clave de
// acceso + búsqueda acotada) y la expone como función serverless Node.
// El límite del plan Hobby es 60 s: la búsqueda corre acotada para caber.

import { handle } from "hono/vercel";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import Anthropic from "@anthropic-ai/sdk";
import { loadVercelEnv } from "../src/config/vercelEnv.js";
import { createSupplierSource, type SearchBudget } from "../src/sourcing/supplierSource.js";
import { createRedisStore } from "../src/directory/redisStore.js";
import { buildApi } from "../src/server/api.js";

export const runtime = "nodejs";
export const maxDuration = 60;

// Presupuesto acotado para caber en 60 s (afinable midiendo en producción).
// maxVariants 2: el fan-out por defecto es 3 llamadas paralelas al modelo; con
// 2 se recorta ~33% del costo por búsqueda y el dedupe absorbe el solape.
const VERCEL_SEARCH_BUDGET: SearchBudget = {
  maxWebSearchUses: 2,
  maxTokens: 8000,
  effort: "low",
  maxVariants: 2,
};

const env = loadVercelEnv();

const redis = new Redis({ url: env.upstashUrl, token: env.upstashToken });
// Upstash puede devolver objetos ya deserializados; forzamos string para
// reusar el parseo zod del store (que espera texto JSON).
const redisLike = {
  get: (key: string): Promise<string | null> =>
    redis
      .get<unknown>(key)
      .then((v) => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v))),
  set: (key: string, value: string): Promise<unknown> => redis.set(key, value),
};
const store = createRedisStore(redisLike);

// Límites de tasa sobre el mismo Redis. Login: frena fuerza bruta sobre la
// ACCESS_KEY por IP. Costly: tope global de llamadas al modelo por hora —
// cada búsqueda son maxVariants llamadas a Opus con web_search (gasto directo).
const LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW = "15 m";
const COSTLY_REQUESTS = 10;
const COSTLY_WINDOW = "1 h";
const rateLimit = {
  login: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(LOGIN_ATTEMPTS, LOGIN_WINDOW),
    prefix: "rl:login",
  }),
  costly: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(COSTLY_REQUESTS, COSTLY_WINDOW),
    prefix: "rl:costly",
  }),
};

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
  rateLimit,
});

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
