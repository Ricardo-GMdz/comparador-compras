import type { Product, Offer } from "./types.js";

// Abstracción de una fuente de productos. Cada implementación concreta
// (web search, scraping, API de tienda, etc.) provee ofertas para un producto.
// El runner del agente depende de esta interfaz, no de implementaciones.
export interface ProductSource {
  /** Identificador estable de la fuente (ej. "web-search"). */
  readonly id: string;
  /** Busca ofertas para el producto dado. Devuelve una lista inmutable. */
  search(product: Product): Promise<readonly Offer[]>;
}
