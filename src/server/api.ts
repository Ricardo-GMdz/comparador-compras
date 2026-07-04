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
