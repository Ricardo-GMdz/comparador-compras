// Runner del agente: orquesta la búsqueda de ofertas en todas las fuentes
// y delega la comparación al módulo `compare`. No conoce detalles de cada
// fuente concreta; depende solo de la interfaz `ProductSource`.

import type { Product, Offer, ComparisonResult } from "../domain/types.js";
import type { ProductSource } from "../domain/source.js";
import { compareOffers } from "../compare/index.js";
import { dedupeOffers } from "./dedupe.js";
import { logger } from "../logging/logger.js";

/** Parámetros de entrada para ejecutar una comparación de producto. */
export interface RunComparisonInput {
  query: string;
  region: string;
  sources: readonly ProductSource[];
}

/**
 * Consulta cada fuente, junta todas las ofertas y delega en `compareOffers`
 * para construir el `ComparisonResult`. Si una fuente falla, se registra el
 * error y se continúa con las demás (la falla de una fuente no aborta todo).
 */
export async function runComparison(input: RunComparisonInput): Promise<ComparisonResult> {
  const product: Product = { query: input.query, region: input.region };

  const offers = await collectOffers(product, input.sources);

  return compareOffers(product, offers);
}

/**
 * Ejecuta la búsqueda en todas las fuentes en paralelo y junta sus ofertas.
 * Cada fuente se aísla: un error en una no impide recolectar las demás.
 */
async function collectOffers(
  product: Product,
  sources: readonly ProductSource[],
): Promise<readonly Offer[]> {
  const results = await Promise.all(sources.map((source) => searchSource(product, source)));

  // Juntamos las ofertas de todas las fuentes y deduplicamos: una misma oferta
  // reportada por varias fuentes no debe inflar el ranking ni la comparación.
  return dedupeOffers(results.flat());
}

/**
 * Busca ofertas en una única fuente, capturando cualquier error.
 * Ante una falla devuelve un arreglo vacío y registra el contexto del error.
 */
async function searchSource(product: Product, source: ProductSource): Promise<readonly Offer[]> {
  try {
    return await source.search(product);
  } catch (error: unknown) {
    logger.error("La fuente falló al buscar ofertas", {
      sourceId: source.id,
      query: product.query,
      region: product.region,
      reason: getErrorMessage(error),
    });
    return [];
  }
}

/** Extrae un mensaje legible de un error de tipo desconocido. */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Error inesperado";
}
