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

  process.stdout.write(
    `Sembrados ${suppliers.length} proveedores en Redis (clave "directorio").\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `Error sembrando Redis: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
