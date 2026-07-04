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
