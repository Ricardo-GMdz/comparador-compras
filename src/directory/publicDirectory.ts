// Directorio público: la selección de proveedores que se publica en la landing.
// Solo entran los trabajados (contactado/cotizó) y solo con campos públicos —
// las notas y los timestamps del directorio privado NUNCA se publican.

import type {
  Availability,
  PriceUnit,
  Supplier,
  SupplierContact,
  SupplierStatus,
} from "../domain/supplier.js";

/** Estados que habilitan la publicación de un proveedor. */
const PUBLISHABLE_STATUSES: readonly SupplierStatus[] = ["contactado", "cotizó"];

/** Proveedor tal como se expone públicamente en la landing. */
export interface PublicSupplier {
  name: string;
  material: string;
  region: string;
  website?: string;
  wholesalePrice?: number;
  catalogPrice?: number;
  address?: string;
  currency?: string;
  priceUnit?: PriceUnit;
  availability?: Availability;
  moq?: number;
  contact: SupplierContact;
  trusted: boolean;
  status: SupplierStatus;
}

/** Mapea un proveedor del directorio a su versión pública (sin datos privados). */
function toPublic(supplier: Supplier): PublicSupplier {
  return {
    name: supplier.name,
    material: supplier.material,
    region: supplier.region,
    ...(supplier.website !== undefined ? { website: supplier.website } : {}),
    ...(supplier.wholesalePrice !== undefined ? { wholesalePrice: supplier.wholesalePrice } : {}),
    ...(supplier.catalogPrice !== undefined ? { catalogPrice: supplier.catalogPrice } : {}),
    ...(supplier.address !== undefined ? { address: supplier.address } : {}),
    ...(supplier.currency !== undefined ? { currency: supplier.currency } : {}),
    ...(supplier.priceUnit !== undefined ? { priceUnit: supplier.priceUnit } : {}),
    ...(supplier.availability !== undefined ? { availability: supplier.availability } : {}),
    ...(supplier.moq !== undefined ? { moq: supplier.moq } : {}),
    contact: { ...supplier.contact },
    trusted: supplier.trusted,
    status: supplier.status,
  };
}

/**
 * Construye el directorio público a partir del directorio completo: solo los
 * proveedores con estado publicable, sin notas ni timestamps. Inmutable.
 */
export function buildPublicDirectory(suppliers: readonly Supplier[]): readonly PublicSupplier[] {
  return suppliers.filter((s) => PUBLISHABLE_STATUSES.includes(s.status)).map(toPublic);
}
