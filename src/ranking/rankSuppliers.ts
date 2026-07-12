// Ranking de proveedores: orden y mejor opción por niveles, con descarte de outliers
// y comparación de precios solo dentro de la unidad dominante (espejo de
// `dominantCurrency` del comparador v1: no se comparan precios entre unidades).

import type { PriceUnit, Supplier } from "../domain/supplier.js";

/** Fracción de la mediana por debajo de la cual un precio de mayoreo es outlier. */
const PRICE_OUTLIER_MIN_RATIO = 0.4;
/** Muestra mínima para aplicar la detección de outliers (evita falsos con pocos datos). */
const PRICE_OUTLIER_MIN_SAMPLE = 4;
/** Precio usado al ordenar cuando el proveedor no tiene precio comparable (van al final). */
const NO_PRICE = Number.POSITIVE_INFINITY;

/** Accessor de precio comparable: `undefined` si el proveedor no compite por precio. */
type ComparablePrice = (s: Supplier) => number | undefined;

/** Precio de mayoreo válido: número finito y estrictamente positivo. */
function hasValidPrice(s: Supplier): boolean {
  return (
    s.wholesalePrice !== undefined && Number.isFinite(s.wholesalePrice) && s.wholesalePrice > 0
  );
}

/**
 * Determina la unidad de precio dominante: la `priceUnit` (≠ "unknown") más
 * frecuente entre los proveedores con precio válido. Ante empate, gana la
 * unidad cuyo precio más barato es menor (determinístico, como en v1).
 * Devuelve `undefined` si ningún proveedor declara unidad (todos comparables).
 */
function dominantUnit(suppliers: readonly Supplier[]): PriceUnit | undefined {
  const counts = new Map<PriceUnit, number>();
  const cheapest = new Map<PriceUnit, number>();

  for (const s of suppliers) {
    const price = s.wholesalePrice;
    const unit = s.priceUnit;
    if (price === undefined || !hasValidPrice(s) || unit === undefined || unit === "unknown") {
      continue;
    }
    counts.set(unit, (counts.get(unit) ?? 0) + 1);
    const currentMin = cheapest.get(unit);
    if (currentMin === undefined || price < currentMin) {
      cheapest.set(unit, price);
    }
  }

  let winner: PriceUnit | undefined;
  let maxCount = 0;
  let winnerCheapest = Number.POSITIVE_INFINITY;

  for (const [unit, count] of counts) {
    const unitCheapest = cheapest.get(unit) ?? Number.POSITIVE_INFINITY;
    const winsByCount = count > maxCount;
    // Desempate determinístico: a igual conteo, la unidad con el precio más barato.
    const winsByTieBreak = count === maxCount && unitCheapest < winnerCheapest;
    if (winsByCount || winsByTieBreak) {
      maxCount = count;
      winner = unit;
      winnerCheapest = unitCheapest;
    }
  }

  return winner;
}

/**
 * Construye el accessor de precio comparable para la lista: solo los proveedores
 * de la unidad dominante tienen precio comparable; los demás cuentan como "sin
 * precio". Si nadie declara unidad, todos los precios válidos son comparables.
 */
function makeComparablePrice(suppliers: readonly Supplier[]): ComparablePrice {
  const unit = dominantUnit(suppliers);
  return (s) => {
    if (!hasValidPrice(s)) {
      return undefined;
    }
    if (unit !== undefined && s.priceUnit !== unit) {
      return undefined;
    }
    return s.wholesalePrice;
  };
}

/** Mediana de los precios comparables presentes; undefined si no hay ninguno. */
function medianComparable(
  suppliers: readonly Supplier[],
  priceOf: ComparablePrice,
): number | undefined {
  const prices = suppliers
    .map(priceOf)
    .filter((p): p is number => p !== undefined)
    .sort((a, b) => a - b);
  if (prices.length === 0) {
    return undefined;
  }
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];
}

/** Construye un predicado de outlier según la muestra (siempre false si es chica o sin mediana). */
function makeIsOutlier(
  suppliers: readonly Supplier[],
  priceOf: ComparablePrice,
): (s: Supplier) => boolean {
  const withPrice = suppliers.filter((s) => priceOf(s) !== undefined);
  const median = medianComparable(suppliers, priceOf);
  if (withPrice.length < PRICE_OUTLIER_MIN_SAMPLE || median === undefined) {
    return () => false;
  }
  return (s) => {
    const price = priceOf(s);
    return price !== undefined && price < median * PRICE_OUTLIER_MIN_RATIO;
  };
}

/** Comparador por precio comparable ascendente; seguro ante dos "sin precio". */
function makeByPriceAsc(priceOf: ComparablePrice): (a: Supplier, b: Supplier) => number {
  return (a, b) => {
    const priceA = priceOf(a) ?? NO_PRICE;
    const priceB = priceOf(b) ?? NO_PRICE;
    if (priceA === priceB) {
      return 0;
    }
    return priceA < priceB ? -1 : 1;
  };
}

/**
 * Ordena los proveedores: primero confiables y en la región del usuario, luego
 * por precio de mayoreo ascendente dentro de la unidad dominante (los sin
 * precio comparable, al final).
 */
export function rankSuppliers(suppliers: readonly Supplier[], region: string): readonly Supplier[] {
  const inRegion = region.trim().toLowerCase();
  const byPriceAsc = makeByPriceAsc(makeComparablePrice(suppliers));
  const score = (s: Supplier): number =>
    (s.trusted ? 2 : 0) + (s.region.trim().toLowerCase() === inRegion ? 1 : 0);
  return [...suppliers].sort((a, b) => score(b) - score(a) || byPriceAsc(a, b));
}

/**
 * Elige la mejor opción por niveles (descarta outliers de precio comparable):
 * 1) confiable + en región, más barato; 2) confiable; 3) en región; 4) el más barato.
 * Los precios en una unidad distinta a la dominante no compiten por precio,
 * pero el proveedor sigue siendo elegible dentro de su nivel.
 */
export function selectBestSupplier(
  suppliers: readonly Supplier[],
  region: string,
): Supplier | undefined {
  const inRegion = region.trim().toLowerCase();
  const priceOf = makeComparablePrice(suppliers);
  const byPriceAsc = makeByPriceAsc(priceOf);
  const isOutlier = makeIsOutlier(suppliers, priceOf);
  const eligible = suppliers.filter((s) => !isOutlier(s));
  const isRegion = (s: Supplier): boolean => s.region.trim().toLowerCase() === inRegion;
  const cheapest = (list: readonly Supplier[]): Supplier | undefined =>
    list.length === 0 ? undefined : [...list].sort(byPriceAsc)[0];

  // Preferencia de stock: los "sobre_pedido" solo compiten si no hay alternativa
  // con stock o de disponibilidad desconocida (lo desconocido NO penaliza).
  const hasStockPreference = (s: Supplier): boolean => s.availability !== "sobre_pedido";
  const chain = (list: readonly Supplier[]): Supplier | undefined =>
    cheapest(list.filter((s) => s.trusted && isRegion(s))) ??
    cheapest(list.filter((s) => s.trusted)) ??
    cheapest(list.filter(isRegion)) ??
    cheapest(list);

  return chain(eligible.filter(hasStockPreference)) ?? chain(eligible);
}
