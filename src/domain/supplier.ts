// Tipos de dominio del sourcing de proveedores. Inmutables por convención.

/** Estado de gestión de un proveedor dentro del directorio. */
export type SupplierStatus = "pendiente" | "contactado" | "cotizó" | "descartado";

/** Unidad a la que refiere el precio de mayoreo. */
export type PriceUnit = "pieza" | "kg" | "tonelada" | "m2" | "unknown";

/** Disponibilidad del producto en el proveedor (stock). */
export type Availability = "disponible" | "sobre_pedido" | "unknown";

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
  /** Unidad del precio (ej. por kg vs por pieza); ausente si no se conoce. */
  priceUnit?: PriceUnit;
  /** Precio de catálogo/lista publicado (distinto del mayoreo). */
  catalogPrice?: number;
  /** Dirección o ciudad publicada del proveedor. */
  address?: string;
  /** Disponibilidad/stock reportada; ausente si no se conoce. */
  availability?: Availability;
  currency?: string;
  /** Mínimo de compra (informativo; no ordena el ranking). */
  moq?: number;
  contact: SupplierContact;
  /** Empresa verificada/reconocida vs desconocida. */
  trusted: boolean;
  notes?: string;
}

/** Proveedor persistido en el directorio: candidate + gestión + timestamps ISO 8601. */
export interface Supplier extends SupplierCandidate {
  /** Estado de gestión; los persistidos viejos migran a "pendiente" al leer. */
  status: SupplierStatus;
  /** Marca de favorito del usuario (gestión manual; el sourcing no la toca). */
  favorite?: boolean;
  firstSeen: string;
  lastSeen: string;
}
