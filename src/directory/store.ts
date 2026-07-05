// Directorio de proveedores: identidad, merge y persistencia en JSON.

import { readFile, writeFile, rename } from "node:fs/promises";
import { z } from "zod";
import type { Supplier, SupplierCandidate } from "../domain/supplier.js";

/** Extrae el dominio (sin www) de una URL; undefined si no es válida. */
function domainOf(website: string | undefined): string | undefined {
  if (website === undefined) {
    return undefined;
  }
  try {
    return new URL(website).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Clave de identidad de un proveedor: dominio del sitio si existe; si no,
 * nombre normalizado + región. Determina qué proveedores se fusionan.
 */
export function supplierKey(supplier: SupplierCandidate): string {
  const domain = domainOf(supplier.website);
  if (domain !== undefined) {
    return `d:${domain}`;
  }
  const name = supplier.name.trim().toLowerCase();
  const region = supplier.region.trim().toLowerCase();
  return `n:${name}|${region}`;
}

/** Resultado de un merge: el directorio nuevo y cuántos proveedores se agregaron. */
export interface MergeResult {
  suppliers: readonly Supplier[];
  added: number;
}

/**
 * Fusiona candidatos con el directorio existente (inmutable). Actualiza los que
 * ya están (por clave), conservando `firstSeen` y refrescando `lastSeen`; agrega
 * los nuevos con `firstSeen = lastSeen = now`.
 */
export function mergeSuppliers(
  existing: readonly Supplier[],
  incoming: readonly SupplierCandidate[],
  now: string,
): MergeResult {
  const byKey = new Map<string, Supplier>();
  for (const supplier of existing) {
    byKey.set(supplierKey(supplier), supplier);
  }

  let added = 0;
  for (const candidate of incoming) {
    const key = supplierKey(candidate);
    const prev = byKey.get(key);
    if (prev === undefined) {
      byKey.set(key, { ...candidate, status: "pendiente", firstSeen: now, lastSeen: now });
      added += 1;
    } else {
      // El sourcing refresca datos pero NO pisa la gestión manual (status/notes).
      byKey.set(key, {
        ...candidate,
        status: prev.status,
        notes: prev.notes,
        firstSeen: prev.firstSeen,
        lastSeen: now,
      });
    }
  }

  return { suppliers: [...byKey.values()], added };
}

// Esquema del archivo persistido: validamos al leer (dato de un archivo externo).
const contactSchema = z.object({
  email: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  formUrl: z.string().optional(),
});
const supplierSchema = z.object({
  name: z.string(),
  website: z.string().optional(),
  material: z.string(),
  region: z.string(),
  wholesalePrice: z.number().optional(),
  priceUnit: z.enum(["pieza", "kg", "tonelada", "m2", "unknown"]).optional(),
  currency: z.string().optional(),
  moq: z.number().optional(),
  contact: contactSchema,
  trusted: z.boolean(),
  notes: z.string().optional(),
  // Migración: los directorios pre-v2.1 no traen `status`; entran como "pendiente".
  status: z.enum(["pendiente", "contactado", "cotizó", "descartado"]).default("pendiente"),
  firstSeen: z.string(),
  lastSeen: z.string(),
});
const directorySchema = z.array(supplierSchema);

/**
 * Carga el directorio desde `path`. Si el archivo no existe, devuelve `[]`.
 * Valida el contenido con zod (falla explícito si el archivo está corrupto).
 */
export async function loadDirectory(path: string): Promise<readonly Supplier[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return directorySchema.parse(JSON.parse(raw));
}

/** Guarda el directorio en `path` de forma atómica (escribe a temp y renombra). */
export async function saveDirectory(path: string, suppliers: readonly Supplier[]): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(suppliers, null, 2), "utf8");
  await rename(tmp, path);
}
