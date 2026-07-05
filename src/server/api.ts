// API HTTP (Hono): buscar proveedores, leer/gestionar el directorio y exportar CSV.
// Dependencias inyectadas.

import { Hono } from "hono";
import { z } from "zod";
import type { Supplier } from "../domain/supplier.js";
import type { SupplierSource } from "../sourcing/supplierSource.js";
import { mergeSuppliers, removeSupplier, supplierKey, updateSupplier } from "../directory/store.js";
import { rankSuppliers, selectBestSupplier } from "../ranking/rankSuppliers.js";
import { buildQuoteMessage } from "../quotes/quoteTemplate.js";
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

// Body del PATCH de gestión: status y/o notes, con al menos uno presente.
const patchSchema = z
  .object({
    status: z.enum(["pendiente", "contactado", "cotizó", "descartado"]).optional(),
    notes: z.string().optional(),
  })
  .refine((patch) => patch.status !== undefined || patch.notes !== undefined, {
    message: "Se requiere al menos 'status' o 'notes'.",
  });

// Query del pedido de cotización: cantidad y especificación, ambas requeridas.
const cotizacionSchema = z.object({
  quantity: z.string().min(1),
  spec: z.string().min(1),
});

/** Columnas del CSV exportado, en orden. */
const CSV_COLUMNS = [
  "name",
  "website",
  "material",
  "region",
  "wholesalePrice",
  "priceUnit",
  "currency",
  "moq",
  "email",
  "phone",
  "whatsapp",
  "formUrl",
  "trusted",
  "status",
  "notes",
  "firstSeen",
  "lastSeen",
] as const;

/** Escapa un campo CSV: comillas duplicadas y comillas alrededor si hay coma/quote/salto. */
function csvField(value: string | number | boolean | undefined): string {
  if (value === undefined) {
    return "";
  }
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

/** Serializa el directorio a CSV (header + una fila por proveedor). */
function toCsv(suppliers: readonly Supplier[]): string {
  const rows = suppliers.map((s) =>
    [
      s.name,
      s.website,
      s.material,
      s.region,
      s.wholesalePrice,
      s.priceUnit,
      s.currency,
      s.moq,
      s.contact.email,
      s.contact.phone,
      s.contact.whatsapp,
      s.contact.formUrl,
      s.trusted,
      s.status,
      s.notes,
      s.firstSeen,
      s.lastSeen,
    ]
      .map(csvField)
      .join(","),
  );
  return [CSV_COLUMNS.join(","), ...rows].join("\n");
}

/** Decodifica la key URL-encodeada; si viene malformada, la usa tal cual. */
function decodeKey(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Proveedores que compiten por mejor opción (los descartados quedan fuera). */
function activeSuppliers(suppliers: readonly Supplier[]): readonly Supplier[] {
  return suppliers.filter((s) => s.status !== "descartado");
}

export function buildApi(deps: ApiDeps): Hono {
  const app = new Hono();

  app.get("/api/directorio", async (c) => {
    const suppliers = await deps.loadDirectory(deps.directoryPath);
    const region = c.req.query("region") ?? "global";
    return c.json({ ok: true, suppliers: rankSuppliers(suppliers, region) });
  });

  app.get("/api/directorio.csv", async (c) => {
    const suppliers = await deps.loadDirectory(deps.directoryPath);
    return c.body(toCsv(suppliers), 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="directorio.csv"',
    });
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
        // Los descartados siguen listados, pero nunca compiten por mejor opción.
        mejorOpcion: selectBestSupplier(activeSuppliers(suppliers), region) ?? null,
        nuevos: added,
        total: suppliers.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error inesperado";
      logger.error("buscar: falló el sourcing", { query, region, error: message });
      return c.json({ ok: false, error: `Falló la búsqueda: ${message}` }, 502);
    }
  });

  app.patch("/api/proveedor/:key", async (c) => {
    const key = decodeKey(c.req.param("key"));
    const parsed = patchSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json(
        { ok: false, error: "Body inválido: se espera 'status' (enum) y/o 'notes' (texto)." },
        400,
      );
    }
    const suppliers = await deps.loadDirectory(deps.directoryPath);
    const updated = updateSupplier(suppliers, key, parsed.data, deps.now());
    if (updated === undefined) {
      return c.json({ ok: false, error: `No existe un proveedor con key '${key}'.` }, 404);
    }
    await deps.saveDirectory(deps.directoryPath, updated);
    return c.json({ ok: true });
  });

  app.get("/api/proveedor/:key/cotizacion", async (c) => {
    const key = decodeKey(c.req.param("key"));
    const parsed = cotizacionSchema.safeParse({
      quantity: c.req.query("quantity"),
      spec: c.req.query("spec"),
    });
    if (!parsed.success) {
      return c.json(
        { ok: false, error: "Parámetros inválidos: se requieren 'quantity' y 'spec'." },
        400,
      );
    }
    const suppliers = await deps.loadDirectory(deps.directoryPath);
    const supplier = suppliers.find((s) => supplierKey(s) === key);
    if (supplier === undefined) {
      return c.json({ ok: false, error: `No existe un proveedor con key '${key}'.` }, 404);
    }
    // El mensaje se arma en el server con el template local: una sola fuente
    // de verdad (el front no duplica el texto).
    return c.json({
      ok: true,
      message: buildQuoteMessage({
        supplierName: supplier.name,
        material: supplier.material,
        quantity: parsed.data.quantity,
        spec: parsed.data.spec,
      }),
    });
  });

  app.post("/api/proveedor/:key/enriquecer", async (c) => {
    const key = decodeKey(c.req.param("key"));
    const suppliers = await deps.loadDirectory(deps.directoryPath);
    const supplier = suppliers.find((s) => supplierKey(s) === key);
    if (supplier === undefined) {
      return c.json({ ok: false, error: `No existe un proveedor con key '${key}'.` }, 404);
    }

    try {
      const found = await deps.source.enrichContact(supplier);
      // Merge conservador: lo existente gana; solo se completan campos faltantes.
      const updated = updateSupplier(suppliers, key, { contact: found }, deps.now());
      if (updated === undefined) {
        return c.json({ ok: false, error: `No existe un proveedor con key '${key}'.` }, 404);
      }
      await deps.saveDirectory(deps.directoryPath, updated);
      const merged = updated.find((s) => supplierKey(s) === key);
      return c.json({ ok: true, contact: merged?.contact ?? {} });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error inesperado";
      logger.error("enriquecer: falló el enriquecimiento de contacto", { key, error: message });
      return c.json({ ok: false, error: `Falló el enriquecimiento: ${message}` }, 502);
    }
  });

  app.delete("/api/proveedor/:key", async (c) => {
    const key = decodeKey(c.req.param("key"));
    const suppliers = await deps.loadDirectory(deps.directoryPath);
    const remaining = removeSupplier(suppliers, key);
    if (remaining === undefined) {
      return c.json({ ok: false, error: `No existe un proveedor con key '${key}'.` }, 404);
    }
    await deps.saveDirectory(deps.directoryPath, remaining);
    return c.json({ ok: true });
  });

  return app;
}
