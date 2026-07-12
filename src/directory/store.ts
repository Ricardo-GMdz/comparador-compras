// Directorio de proveedores: identidad, merge y persistencia en JSON.

import { readFile, writeFile, rename } from "node:fs/promises";
import { z } from "zod";
import type {
  Supplier,
  SupplierCandidate,
  SupplierContact,
  SupplierStatus,
} from "../domain/supplier.js";

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
      // Re-avistamiento: lo nuevo actualiza, pero lo que el candidato NO trae
      // se conserva (un re-avistamiento sin precio no borra el precio que ya
      // teníamos). El candidato se construye solo con campos presentes, así
      // que el spread sobre `prev` pisa únicamente lo que sí vino. El contacto
      // mergea por campo, y la gestión manual (status/notas del usuario) gana.
      byKey.set(key, {
        ...prev,
        ...candidate,
        contact: { ...prev.contact, ...candidate.contact },
        status: prev.status,
        ...(prev.notes !== undefined
          ? { notes: prev.notes }
          : candidate.notes !== undefined
            ? { notes: candidate.notes }
            : {}),
        firstSeen: prev.firstSeen,
        lastSeen: now,
      });
    }
  }

  return { suppliers: [...byKey.values()], added };
}

/** Cambios de gestión manual aplicables a un proveedor del directorio. */
export interface SupplierPatch {
  status?: SupplierStatus;
  notes?: string;
  /** Contacto a mergear: solo completa campos faltantes (lo existente gana). */
  contact?: SupplierContact;
}

/**
 * Aplica un patch de gestión al proveedor identificado por `key` (inmutable).
 * Refresca `lastSeen` y conserva el resto de los campos. El `contact` del patch
 * se mergea de forma superficial conservando lo existente (no pisa datos).
 * Devuelve `undefined` si la key no existe en el directorio.
 */
export function updateSupplier(
  suppliers: readonly Supplier[],
  key: string,
  patch: SupplierPatch,
  now: string,
): readonly Supplier[] | undefined {
  const index = suppliers.findIndex((supplier) => supplierKey(supplier) === key);
  if (index === -1) {
    return undefined;
  }
  const current = suppliers[index] as Supplier;
  const updated: Supplier = {
    ...current,
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.contact !== undefined ? { contact: { ...patch.contact, ...current.contact } } : {}),
    lastSeen: now,
  };
  return [...suppliers.slice(0, index), updated, ...suppliers.slice(index + 1)];
}

/**
 * Elimina del directorio el proveedor identificado por `key` (inmutable).
 * Devuelve `undefined` si la key no existe.
 */
export function removeSupplier(
  suppliers: readonly Supplier[],
  key: string,
): readonly Supplier[] | undefined {
  const index = suppliers.findIndex((supplier) => supplierKey(supplier) === key);
  if (index === -1) {
    return undefined;
  }
  return [...suppliers.slice(0, index), ...suppliers.slice(index + 1)];
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
  availability: z.enum(["disponible", "sobre_pedido", "unknown"]).optional(),
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
export const directorySchema = z.array(supplierSchema);

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
