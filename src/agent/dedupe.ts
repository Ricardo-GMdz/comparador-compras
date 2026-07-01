// Deduplicado de ofertas combinadas de varias fuentes. Dos ofertas se
// consideran la misma si comparten proveedor, título, moneda, condición y
// variante (normalizados); ante duplicados se conserva la de menor precio.

import type { Offer } from "../domain/types.js";

// Valor usado cuando la condición no está presente (equivale a desconocida).
const UNKNOWN_CONDITION = "unknown";

// Gama por defecto cuando la oferta no trae variante (equivale a gama base).
const BASE_TIER_RANK = 0;

/**
 * Construye la clave de identidad de una oferta para deduplicar. Incluye la
 * variante (`tierRank`) porque es un eje de identidad de primera clase: dos
 * gamas distintas del mismo producto (ej. 128GB vs 256GB) suelen compartir
 * `productTitle`, moneda y condición, y sin el `tierRank` colapsarían en una,
 * descartando silenciosamente la gama superior y anulando la sugerencia de
 * upgrade (que corre después del dedupe).
 */
function offerKey(offer: Offer): string {
  const provider = offer.provider.name.trim().toLowerCase();
  const title = offer.productTitle.trim().toLowerCase();
  const currency = offer.currency.trim().toUpperCase();
  const condition = offer.condition ?? UNKNOWN_CONDITION;
  const tier = String(offer.variant?.tierRank ?? BASE_TIER_RANK);
  return [provider, title, currency, condition, tier].join("|");
}

/**
 * Fusiona ofertas duplicadas provenientes de varias fuentes. Dos ofertas con
 * la misma identidad (proveedor + título + moneda + condición + variante,
 * normalizados) se consolidan en una: la de menor precio. Inmutable: no muta
 * la entrada.
 */
export function dedupeOffers(offers: readonly Offer[]): readonly Offer[] {
  const byKey = new Map<string, Offer>();

  for (const offer of offers) {
    const key = offerKey(offer);
    const existing = byKey.get(key);
    if (existing === undefined || offer.priceAmount < existing.priceAmount) {
      byKey.set(key, offer);
    }
  }

  return [...byKey.values()];
}
