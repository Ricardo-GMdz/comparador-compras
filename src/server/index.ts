// Entry del servidor: arma dependencias reales y sirve API + estáticos de web/.

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { rename, writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { loadDotenvIfPresent } from "../config/loadDotenv.js";
import { loadEnv } from "../config/env.js";
import { logger } from "../logging/logger.js";
import { createSupplierSource } from "../sourcing/supplierSource.js";
import { loadDirectory, saveDirectory } from "../directory/store.js";
import type { PublicSupplier } from "../directory/publicDirectory.js";
import { buildApi } from "./api.js";

const PORT = 8787;
const DIRECTORY_PATH = "directorio.json";
// El directorio público vive dentro de landing/ para que GitHub Pages lo sirva
// junto a la landing (publicarlo en la web = commitear y pushear este archivo).
const PUBLIC_DIRECTORY_PATH = "landing/proveedores.json";

loadDotenvIfPresent();
const env = loadEnv();

// Escritura atómica del directorio público (mismo patrón que el store privado).
async function savePublicDirectory(suppliers: readonly PublicSupplier[]): Promise<void> {
  const tmp = `${PUBLIC_DIRECTORY_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(suppliers, null, 2), "utf8");
  await rename(tmp, PUBLIC_DIRECTORY_PATH);
}

const client = new Anthropic({ apiKey: env.anthropicApiKey });
const app = buildApi({
  source: createSupplierSource({ client }),
  loadDirectory,
  saveDirectory,
  savePublicDirectory,
  now: () => new Date().toISOString(),
  directoryPath: DIRECTORY_PATH,
});

// Servir el frontend estático desde web/.
app.get("/*", serveStatic({ root: "./web" }));

serve({ fetch: app.fetch, port: PORT }, () => {
  logger.info("servidor de proveedores escuchando", { url: `http://localhost:${PORT}` });
});
