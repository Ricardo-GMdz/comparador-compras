// Tipos de dominio: fuente de verdad para todos los módulos del proyecto.
// Todos los objetos se tratan como inmutables (nunca se mutan en el lugar).

/** Proveedor o tienda donde se ofrece un producto. */
export interface Provider {
  name: string;
  url?: string;
  /** Indica si la fuente es confiable (tienda reconocida vs. desconocida). */
  trusted: boolean;
}

/** Oferta concreta de un producto en un proveedor y región dados. */
export interface Offer {
  productTitle: string;
  provider: Provider;
  /** Monto numérico del precio, en la moneda indicada por `currency`. */
  priceAmount: number;
  /** Código de moneda ISO 4217 (ej. "USD", "EUR", "PYG"). */
  currency: string;
  /** Código de región que condiciona moneda y tiendas (ej. "us", "global"). */
  region: string;
  url?: string;
  /** Texto crudo de la fuente, útil para depuración y trazabilidad. */
  raw?: string;
}

/** Producto buscado por el usuario, acotado a una región. */
export interface Product {
  query: string;
  region: string;
}

/** Resultado de comparar ofertas de un producto. */
export interface ComparisonResult {
  product: Product;
  /** Ofertas consideradas, normalmente ya normalizadas y ordenadas. */
  offers: readonly Offer[];
  /** Mejor opción según el ranking, si existe alguna oferta. */
  best?: Offer;
  /** Sugerencia de upgrade en un rango de precio similar, si aplica. */
  upgradeSuggestion?: Offer;
  /** Notas adicionales para el usuario (advertencias, contexto, etc.). */
  notes?: string;
}
