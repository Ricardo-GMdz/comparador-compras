// API HTTP (Hono): buscar proveedores, leer/gestionar el directorio y exportar CSV.
// Dependencias inyectadas.

import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { COOKIE_NAME, PUBLIC_PATHS, hashEqual, makeToken, verifyToken } from "./auth.js";
import type { Supplier } from "../domain/supplier.js";
import type { SupplierSource } from "../sourcing/supplierSource.js";
import { mergeSuppliers, removeSupplier, supplierKey, updateSupplier } from "../directory/store.js";
import { buildPublicDirectory, type PublicSupplier } from "../directory/publicDirectory.js";
import { rankSuppliers, selectBestSupplier } from "../ranking/rankSuppliers.js";
import { buildQuoteMessage } from "../quotes/quoteTemplate.js";
import { logger } from "../logging/logger.js";

/** Dependencias de la API (inyectables para test). */
export interface ApiDeps {
  source: SupplierSource;
  loadDirectory: (path: string) => Promise<readonly Supplier[]>;
  saveDirectory: (path: string, suppliers: readonly Supplier[]) => Promise<void>;
  /** Escribe el directorio público (la selección que muestra la landing). */
  savePublicDirectory: (suppliers: readonly PublicSupplier[]) => Promise<void>;
  /** Lee el directorio público (para /api/publico). */
  loadPublicDirectory: () => Promise<readonly PublicSupplier[]>;
  now: () => string;
  directoryPath: string;
  /** Si está presente, todas las rutas /api exigen la clave (menos login/publico). */
  auth?: { accessKey: string; now?: () => number };
}

// Duración de la cookie de sesión: 30 días.
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

const buscarSchema = z.object({
  query: z.string().min(1),
  region: z.string().min(1).default("global"),
});

// Body del PATCH de gestión: status, notes y/o favorite, con al menos uno presente.
const patchSchema = z
  .object({
    status: z.enum(["pendiente", "contactado", "cotizó", "descartado"]).optional(),
    notes: z.string().optional(),
    favorite: z.boolean().optional(),
  })
  .refine(
    (patch) =>
      patch.status !== undefined || patch.notes !== undefined || patch.favorite !== undefined,
    { message: "Se requiere al menos 'status', 'notes' o 'favorite'." },
  );

// Query del pedido de cotización: cantidad y especificación, ambas requeridas.
const cotizacionSchema = z.object({
  quantity: z.string().min(1),
  spec: z.string().min(1),
});

/** Columnas del CSV exportado (resumen legible en español), en orden. */
const CSV_COLUMNS = [
  "Proveedor",
  "Sitio web",
  "Material",
  "Región",
  "Precio",
  "Moneda",
  "Email",
  "WhatsApp",
  "Teléfono",
  "Dirección",
  "Estado",
  "Favorito",
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
      s.wholesalePrice ?? s.catalogPrice,
      s.currency,
      s.contact.email,
      s.contact.whatsapp,
      s.contact.phone,
      s.address,
      s.status,
      s.favorite ? "sí" : "",
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

  if (deps.auth !== undefined) {
    const { accessKey } = deps.auth;
    const now = deps.auth.now ?? (() => Date.now());

    // Middleware: exige cookie válida en /api/* (menos login y público).
    app.use("*", async (c, next) => {
      // Usamos c.req.path (decodeado igual que el router de Hono): con
      // new URL().pathname el path NO se percent-decodea y una ruta encodeada
      // como /%61pi/directorio evadiría el guard pero igual routearía. Deben
      // ver el path idéntico middleware y router.
      const path = c.req.path;
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

  // Directorio público (sin clave): la landing lo consume. CORS abierto a propósito.
  app.get("/api/publico", async (c) => {
    const publicSuppliers = await deps.loadPublicDirectory();
    return c.json(publicSuppliers, 200, { "access-control-allow-origin": "*" });
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
      // La mejor opción se elige SOLO entre lo hallado en ESTA búsqueda (sus
      // versiones ya mergeadas): el directorio acumula rubros distintos y no
      // tiene sentido comparar precios entre rubros. Descartados fuera.
      const foundKeys = new Set(candidates.map(supplierKey));
      const foundSuppliers = activeSuppliers(suppliers).filter((s) =>
        foundKeys.has(supplierKey(s)),
      );
      return c.json({
        ok: true,
        suppliers: rankSuppliers(suppliers, region),
        mejorOpcion: selectBestSupplier(foundSuppliers, region) ?? null,
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
        {
          ok: false,
          error:
            "Body inválido: se espera 'status' (enum), 'notes' (texto) y/o 'favorite' (booleano).",
        },
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

  // Publica la selección (contactados/cotizó, sin datos privados) para la landing.
  app.post("/api/publicar", async (c) => {
    try {
      const suppliers = await deps.loadDirectory(deps.directoryPath);
      const publicSuppliers = buildPublicDirectory(suppliers);
      await deps.savePublicDirectory(publicSuppliers);
      return c.json({ ok: true, publicados: publicSuppliers.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error inesperado";
      logger.error("publicar: falló la escritura del directorio público", { error: message });
      return c.json({ ok: false, error: `No se pudo publicar: ${message}` }, 500);
    }
  });

  return app;
}
