import type { Offer, Product, ComparisonResult } from "../domain/types.js";
import {
  PRICE_ROUNDING_FACTOR,
  UPGRADE_MAX_PRICE_RATIO,
  UPGRADE_MIN_PRICE_RATIO,
} from "./constants.js";

// Módulo de comparación: funciones puras e inmutables que normalizan,
// ordenan y comparan ofertas para producir un ComparisonResult.

/**
 * Normaliza el código de moneda: lo recorta y lo lleva a mayúsculas.
 * No valida contra ISO 4217 (eso es responsabilidad de la fuente).
 */
function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

/**
 * Redondea un monto a la cantidad de decimales configurada.
 * Devuelve `0` para valores no finitos o negativos, evitando precios inválidos.
 */
function normalizeAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    return 0;
  }

  return Math.round(amount * PRICE_ROUNDING_FACTOR) / PRICE_ROUNDING_FACTOR;
}

/**
 * Normaliza y limpia el precio de una oferta de forma inmutable.
 * Redondea el monto, sanea valores inválidos y normaliza la moneda.
 * Devuelve siempre una copia nueva; nunca muta la oferta original.
 */
export function normalizePrice(offer: Offer): Offer {
  return {
    ...offer,
    priceAmount: normalizeAmount(offer.priceAmount),
    currency: normalizeCurrency(offer.currency),
  };
}

/**
 * Indica si una oferta tiene un precio de venta legítimo: un número finito y
 * estrictamente positivo. Un monto ausente, no finito, negativo o 0 producto de
 * un saneo (ver `normalizeAmount`) NO es un precio real y no debe entrar al
 * ranking: tratarlo como "gratis" lo promovería al tope como la opción más
 * barata, que es peor que descartarlo.
 */
function hasValidPrice(offer: Offer): boolean {
  return Number.isFinite(offer.priceAmount) && offer.priceAmount > 0;
}

/**
 * Determina la moneda dominante (la más frecuente) entre las ofertas.
 * Ante empate en el conteo, el desempate es explícito y determinístico: gana la
 * moneda cuya oferta más barata es menor (independiente del orden de llegada de
 * las fuentes). Asume que todas las ofertas ya tienen precio válido.
 * Devuelve `undefined` si la lista está vacía.
 */
function dominantCurrency(offers: readonly Offer[]): string | undefined {
  const counts = new Map<string, number>();
  const cheapest = new Map<string, number>();

  for (const offer of offers) {
    counts.set(offer.currency, (counts.get(offer.currency) ?? 0) + 1);

    const currentMin = cheapest.get(offer.currency);
    if (currentMin === undefined || offer.priceAmount < currentMin) {
      cheapest.set(offer.currency, offer.priceAmount);
    }
  }

  let winner: string | undefined;
  let maxCount = 0;
  let winnerCheapest = Number.POSITIVE_INFINITY;

  for (const [currency, count] of counts) {
    const currencyCheapest = cheapest.get(currency) ?? Number.POSITIVE_INFINITY;

    const winsByCount = count > maxCount;
    // Desempate determinístico: a igual conteo, la moneda con la oferta más
    // barata (no depende del orden de inserción del Map ni de las fuentes).
    const winsByTieBreak = count === maxCount && currencyCheapest < winnerCheapest;

    if (winsByCount || winsByTieBreak) {
      maxCount = count;
      winner = currency;
      winnerCheapest = currencyCheapest;
    }
  }

  return winner;
}

/**
 * Ordena las ofertas por precio ascendente, considerando únicamente las que
 * comparten la moneda dominante (no se puede comparar precios entre monedas).
 * Se descartan: las ofertas con precio inválido/no positivo y las de otras
 * monedas. Inmutable: devuelve un arreglo nuevo sin tocar la entrada.
 */
export function rankOffers(offers: readonly Offer[]): readonly Offer[] {
  // Filtramos antes de elegir moneda dominante para que una oferta con precio
  // corrupto (NaN, negativo) no se cuele como "la más barata" tras el saneo.
  const priced = offers.map(normalizePrice).filter(hasValidPrice);
  const currency = dominantCurrency(priced);

  if (currency === undefined) {
    return [];
  }

  const comparable = priced.filter((offer) => offer.currency === currency);

  // Copia antes de ordenar para no mutar `comparable` (que ya es nuevo, pero
  // mantenemos la disciplina inmutable de forma explícita).
  return [...comparable].sort((a, b) => a.priceAmount - b.priceAmount);
}

/**
 * Indica si una oferta puede sugerirse como upgrade respecto de la mejor:
 * debe ser confiable, tener un título distinto y caer dentro del rango de
 * precio similar (entre el piso y el tope configurados).
 */
function isUpgradeCandidate(candidate: Offer, best: Offer): boolean {
  const minPrice = best.priceAmount * UPGRADE_MIN_PRICE_RATIO;
  const maxPrice = best.priceAmount * UPGRADE_MAX_PRICE_RATIO;

  return (
    candidate.provider.trusted &&
    candidate.productTitle !== best.productTitle &&
    candidate.priceAmount > minPrice &&
    candidate.priceAmount <= maxPrice
  );
}

/**
 * Compara las ofertas de un producto y arma el ComparisonResult.
 *
 * - `offers`: ofertas normalizadas y ordenadas por precio (moneda dominante).
 * - `best`: la oferta confiable más barata; si no hay ninguna confiable,
 *   queda `undefined` y se anota la advertencia correspondiente.
 * - `upgradeSuggestion`: la primera oferta confiable, con título distinto,
 *   dentro del rango de precio similar por encima de la mejor.
 *
 * Función pura e inmutable: no muta la entrada ni produce efectos colaterales.
 */
export function compareOffers(product: Product, offers: readonly Offer[]): ComparisonResult {
  const ranked = rankOffers(offers);

  if (ranked.length === 0) {
    return {
      product,
      offers: ranked,
      notes: "No se encontraron ofertas comparables para el producto.",
    };
  }

  const best = ranked.find((offer) => offer.provider.trusted);

  if (best === undefined) {
    return {
      product,
      offers: ranked,
      notes: "No se encontraron ofertas de proveedores confiables; revisar manualmente.",
    };
  }

  const upgradeSuggestion = ranked.find((offer) => isUpgradeCandidate(offer, best));

  // Construimos el resultado sin claves opcionales en `undefined` para
  // mantener objetos limpios y predecibles.
  return upgradeSuggestion === undefined
    ? { product, offers: ranked, best }
    : { product, offers: ranked, best, upgradeSuggestion };
}
