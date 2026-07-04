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
