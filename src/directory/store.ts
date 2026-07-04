// Directorio de proveedores: identidad, merge y persistencia en JSON.

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
      byKey.set(key, { ...candidate, firstSeen: now, lastSeen: now });
      added += 1;
    } else {
      byKey.set(key, { ...candidate, firstSeen: prev.firstSeen, lastSeen: now });
    }
  }

  return { suppliers: [...byKey.values()], added };
}
