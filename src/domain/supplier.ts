// Tipos de dominio del sourcing de proveedores. Inmutables por convención.

/** Datos de contacto reunidos de un proveedor (nunca se envía nada). */
export interface SupplierContact {
  email?: string;
  phone?: string;
  whatsapp?: string;
  formUrl?: string;
}

/** Proveedor tal como lo produce el sourcing, sin metadata del directorio. */
export interface SupplierCandidate {
  name: string;
  /** Sitio del proveedor; base para la clave de identidad del directorio. */
  website?: string;
  /** Producto/material que provee. */
  material: string;
  /** Código de región (ej. "mx", "global"). */
  region: string;
  /** Precio de mayoreo por unidad. */
  wholesalePrice?: number;
  currency?: string;
  /** Mínimo de compra (informativo; no ordena el ranking). */
  moq?: number;
  contact: SupplierContact;
  /** Empresa verificada/reconocida vs desconocida. */
  trusted: boolean;
  notes?: string;
}

/** Proveedor persistido en el directorio: candidate + timestamps ISO 8601. */
export interface Supplier extends SupplierCandidate {
  firstSeen: string;
  lastSeen: string;
}
