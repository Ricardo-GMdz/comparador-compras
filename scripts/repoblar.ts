// Re-poblado seguro del directorio en Redis. Para cada query (argv), busca en
// modo LOCAL sin recortes (mejor detalle: catálogo/dirección), mergea con el
// directorio actual de Redis (mergeSuppliers CONSERVA favoritos/estados/notas y
// solo suma/actualiza datos del sourcing) y guarda de vuelta en Redis.
//
// No pisa tu trabajo en vivo: baja el estado actual de Redis antes de mergear.
//
// Uso: pnpm dlx tsx scripts/repoblar.ts "Dinamómetro digital Extech 475040" "otro producto"

import { Redis } from "@upstash/redis";
import Anthropic from "@anthropic-ai/sdk";
import { loadDotenvIfPresent } from "../src/config/loadDotenv.js";
import { createRedisStore } from "../src/directory/redisStore.js";
import { createSupplierSource } from "../src/sourcing/supplierSource.js";
import { mergeSuppliers } from "../src/directory/store.js";
import type { Supplier } from "../src/domain/supplier.js";

// Región de las búsquedas: igual a la del directorio existente para que los
// proveedores sin sitio (clave por nombre+región) mergeen en vez de duplicarse.
const REGION = "mx";
// La clave de Redis del directorio privado (misma que usa el store/entry).
const DIRECTORY_KEY = "directorio";

function out(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

async function main(): Promise<void> {
  loadDotenvIfPresent();

  const queries = process.argv.slice(2).filter((q) => q.trim().length > 0);
  if (queries.length === 0) {
    throw new Error('Pasá al menos una búsqueda. Ej: tsx scripts/repoblar.ts "Extech 475040"');
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!anthropicApiKey) {
    throw new Error("Falta ANTHROPIC_API_KEY en el entorno.");
  }
  if (!url || !token) {
    throw new Error(
      "Faltan credenciales de Redis (UPSTASH_REDIS_REST_URL/TOKEN o KV_REST_API_URL/TOKEN).",
    );
  }

  const redis = new Redis({ url, token });
  const redisLike = {
    get: (key: string): Promise<string | null> =>
      redis
        .get<unknown>(key)
        .then((v) => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v))),
    set: (key: string, value: string): Promise<unknown> => redis.set(key, value),
  };
  const store = createRedisStore(redisLike);

  const client = new Anthropic({ apiKey: anthropicApiKey });
  // Sin searchBudget: búsqueda sin recortes (máximo detalle), como en local.
  const source = createSupplierSource({
    client,
    localidad: process.env.SOURCING_LOCALIDAD,
  });

  // 1. Bajar el estado actual de Redis (preserva favoritos/estados en vivo).
  let current: readonly Supplier[] = await store.loadDirectory(DIRECTORY_KEY);
  out(`Directorio actual en Redis: ${current.length} proveedores.`);

  // 2. Re-buscar cada producto y mergear (conserva gestión manual, suma datos).
  for (const query of queries) {
    out(`\nBuscando: "${query}" (región ${REGION})…`);
    const candidates = await source.search({ query, region: REGION });
    const now = new Date().toISOString();
    const { suppliers, added } = mergeSuppliers(current, candidates, now);
    current = suppliers;
    out(`  ${candidates.length} hallados · ${added} nuevos · total ${current.length}`);
  }

  // 3. Subir el resultado mergeado a Redis.
  await store.saveDirectory(DIRECTORY_KEY, current);
  out(`\nListo. Directorio actualizado en Redis: ${current.length} proveedores.`);
}

main().catch((error) => {
  process.stderr.write(
    `Error en el re-poblado: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
