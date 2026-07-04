// Ranking de proveedores: orden y mejor opción por niveles, con descarte de outliers.

import type { Supplier } from "../domain/supplier.js";

/** Fracción de la mediana por debajo de la cual un precio de mayoreo es outlier. */
const PRICE_OUTLIER_MIN_RATIO = 0.4;
/** Muestra mínima para aplicar la detección de outliers (evita falsos con pocos datos). */
const PRICE_OUTLIER_MIN_SAMPLE = 4;
/** Precio usado al ordenar cuando el proveedor no tiene precio (van al final). */
const NO_PRICE = Number.POSITIVE_INFINITY;

function priceOf(s: Supplier): number {
  return s.wholesalePrice ?? NO_PRICE;
}

/** Mediana de los precios de mayoreo presentes (>0); undefined si no hay ninguno. */
function medianWholesale(suppliers: readonly Supplier[]): number | undefined {
  const prices = suppliers
    .map((s) => s.wholesalePrice)
    .filter((p): p is number => p !== undefined && Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);
  if (prices.length === 0) {
    return undefined;
  }
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];
}

/** Construye un predicado de outlier según la muestra (siempre false si es chica o sin mediana). */
function makeIsOutlier(suppliers: readonly Supplier[]): (s: Supplier) => boolean {
  const withPrice = suppliers.filter((s) => s.wholesalePrice !== undefined);
  const median = medianWholesale(suppliers);
  if (withPrice.length < PRICE_OUTLIER_MIN_SAMPLE || median === undefined) {
    return () => false;
  }
  return (s) =>
    s.wholesalePrice !== undefined && s.wholesalePrice < median * PRICE_OUTLIER_MIN_RATIO;
}

function byPriceAsc(a: Supplier, b: Supplier): number {
  return priceOf(a) - priceOf(b);
}

/**
 * Ordena los proveedores: primero confiables y en la región del usuario, luego
 * por precio de mayoreo ascendente (los sin precio, al final).
 */
export function rankSuppliers(suppliers: readonly Supplier[], region: string): readonly Supplier[] {
  const inRegion = region.trim().toLowerCase();
  const score = (s: Supplier): number =>
    (s.trusted ? 2 : 0) + (s.region.trim().toLowerCase() === inRegion ? 1 : 0);
  return [...suppliers].sort((a, b) => score(b) - score(a) || byPriceAsc(a, b));
}

/**
 * Elige la mejor opción por niveles (descarta outliers de precio):
 * 1) confiable + en región, más barato; 2) confiable; 3) en región; 4) el más barato.
 */
export function selectBestSupplier(
  suppliers: readonly Supplier[],
  region: string,
): Supplier | undefined {
  const inRegion = region.trim().toLowerCase();
  const isOutlier = makeIsOutlier(suppliers);
  const eligible = suppliers.filter((s) => !isOutlier(s));
  const isRegion = (s: Supplier): boolean => s.region.trim().toLowerCase() === inRegion;
  const cheapest = (list: readonly Supplier[]): Supplier | undefined =>
    list.length === 0 ? undefined : [...list].sort(byPriceAsc)[0];

  return (
    cheapest(eligible.filter((s) => s.trusted && isRegion(s))) ??
    cheapest(eligible.filter((s) => s.trusted)) ??
    cheapest(eligible.filter(isRegion)) ??
    cheapest(eligible)
  );
}
