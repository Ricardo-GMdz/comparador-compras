import type { Offer, OfferCondition, Product, ComparisonResult } from "../domain/types.js";
import {
  PRICE_OUTLIER_MIN_RATIO,
  PRICE_ROUNDING_FACTOR,
  UPGRADE_MAX_PRICE_RATIO,
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
 * Devuelve el rango de gama de una oferta. Las ofertas sin señal de variante
 * se consideran gama base (`0`), de modo que el criterio funcione aunque la
 * fuente no haya podido inferir la variante.
 */
function getTierRank(offer: Offer): number {
  return offer.variant?.tierRank ?? 0;
}

/** Devuelve la condición de una oferta; la ausencia equivale a "unknown". */
function getCondition(offer: Offer): OfferCondition {
  return offer.condition ?? "unknown";
}

/**
 * Indica si la condición de una oferta es aceptable como "mejor opción":
 * nueva o desconocida. Criterio conservador: no penalizamos lo que no sabemos,
 * pero descartamos reacondicionado/usado del best y del upgrade preferidos.
 */
function isPreferredCondition(offer: Offer): boolean {
  const condition = getCondition(offer);
  return condition === "new" || condition === "unknown";
}

/**
 * Indica si una oferta puede sugerirse como upgrade respecto de la mejor:
 * debe ser confiable, de condición aceptable (no reacondicionado/usado), de
 * gama superior (mayor `tierRank`) y costar algo más que la mejor pero dentro
 * del rango competitivo (hasta el tope configurado).
 */
function isUpgradeCandidate(candidate: Offer, best: Offer): boolean {
  const maxPrice = best.priceAmount * UPGRADE_MAX_PRICE_RATIO;

  return (
    candidate.provider.trusted &&
    isPreferredCondition(candidate) &&
    getTierRank(candidate) > getTierRank(best) &&
    candidate.priceAmount > best.priceAmount &&
    candidate.priceAmount <= maxPrice
  );
}

/**
 * Selecciona el mejor upgrade entre las ofertas ya ordenadas por precio.
 * Prefiere la mayor gama (`tierRank`); ante igual gama, la más barata (que por
 * el orden ascendente de `ranked` aparece primero). Devuelve `undefined` si no
 * hay ninguna candidata válida.
 */
function selectUpgrade(ranked: readonly Offer[], best: Offer): Offer | undefined {
  let upgrade: Offer | undefined;

  for (const offer of ranked) {
    if (!isUpgradeCandidate(offer, best)) {
      continue;
    }
    // Solo reemplazamos ante gama estrictamente mayor: así, a igual gama, se
    // conserva la primera (la más barata, por el orden ascendente de `ranked`).
    if (upgrade === undefined || getTierRank(offer) > getTierRank(upgrade)) {
      upgrade = offer;
    }
  }

  return upgrade;
}

/**
 * Calcula la mediana de los precios de un conjunto de ofertas no vacío.
 * Usa una copia ordenada para no mutar la entrada.
 */
function medianPrice(offers: readonly Offer[]): number {
  const prices = offers.map((offer) => offer.priceAmount).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];
}

/**
 * Indica si el precio de una oferta es un outlier por lo bajo: cae por debajo
 * de la fracción configurada de la mediana de las comparables. Solo el extremo
 * bajo importa (un precio alto no es un riesgo de recomendación).
 */
function isPriceOutlier(offer: Offer, median: number): boolean {
  return offer.priceAmount < median * PRICE_OUTLIER_MIN_RATIO;
}

/**
 * Construye el aviso de ofertas omitidas por precio sospechosamente bajo,
 * con la conjugación correcta según la cantidad. Devuelve `undefined` si no
 * se omitió ninguna.
 */
function buildOutlierNote(skipped: number): string | undefined {
  if (skipped <= 0) {
    return undefined;
  }

  const cuenta = skipped === 1 ? "Se omitió 1 oferta" : `Se omitieron ${skipped} ofertas`;
  return `${cuenta} con precio sospechosamente bajo (posible error o promo engañosa); verificá.`;
}

/**
 * Compara las ofertas de un producto y arma el ComparisonResult.
 *
 * - `offers`: ofertas normalizadas y ordenadas por precio (moneda dominante).
 * - `best`: la oferta confiable nueva (o de condición desconocida) más barata.
 *   Si no hay ninguna nueva, cae a la confiable más barata y se anota el aviso.
 * - `upgradeSuggestion`: la versión de mayor gama (`tierRank`) confiable y de
 *   condición aceptable dentro del rango de precio competitivo.
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

  const trusted = ranked.filter((offer) => offer.provider.trusted);

  if (trusted.length === 0) {
    return {
      product,
      offers: ranked,
      notes: "No se encontraron ofertas de proveedores confiables; revisar manualmente.",
    };
  }

  // Detectamos precios sospechosamente bajos respecto de la mediana, para no
  // recomendar una oferta que probablemente sea un error o una promo engañosa.
  const median = medianPrice(ranked);
  const isOutlier = (offer: Offer): boolean => isPriceOutlier(offer, median);

  // Elegimos la confiable más barata que sea de condición preferida y NO
  // outlier; relajamos primero la condición y, en último caso, el outlier.
  // `ranked` está en orden ascendente, así que el primer match es el más barato.
  const best =
    trusted.find((offer) => isPreferredCondition(offer) && !isOutlier(offer)) ??
    trusted.find((offer) => !isOutlier(offer)) ??
    trusted[0];

  const upgradeSuggestion = selectUpgrade(ranked, best);

  // Acumulamos los avisos que apliquen (condición no nueva y outliers omitidos).
  const skippedOutliers = trusted.filter(
    (offer) => offer.priceAmount < best.priceAmount && isOutlier(offer),
  ).length;

  const noteParts = [
    isPreferredCondition(best)
      ? undefined
      : "La mejor opción no es nueva: no se encontraron ofertas nuevas confiables. Revisá la condición.",
    buildOutlierNote(skippedOutliers),
  ].filter((part): part is string => part !== undefined);
  const notes = noteParts.length > 0 ? noteParts.join(" ") : undefined;

  // Construimos el resultado sin claves opcionales en `undefined` para
  // mantener objetos limpios y predecibles.
  return {
    product,
    offers: ranked,
    best,
    ...(upgradeSuggestion !== undefined ? { upgradeSuggestion } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
}
