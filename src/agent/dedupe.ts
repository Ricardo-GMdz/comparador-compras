// Deduplicado de ofertas combinadas de varias fuentes. Dos ofertas se
// consideran la misma si comparten proveedor, título, moneda y condición
// (normalizados); ante duplicados se conserva la de menor precio.

import type { Offer } from "../domain/types.js";

// Valor usado cuando la condición no está presente (equivale a desconocida).
const UNKNOWN_CONDITION = "unknown";

/** Construye la clave de identidad de una oferta para deduplicar. */
function offerKey(offer: Offer): string {
  const provider = offer.provider.name.trim().toLowerCase();
  const title = offer.productTitle.trim().toLowerCase();
  const currency = offer.currency.trim().toUpperCase();
  const condition = offer.condition ?? UNKNOWN_CONDITION;
  return [provider, title, currency, condition].join("|");
}

/**
 * Fusiona ofertas duplicadas provenientes de varias fuentes. Dos ofertas con
 * la misma identidad (proveedor + título + moneda + condición, normalizados)
 * se consolidan en una: la de menor precio. Inmutable: no muta la entrada.
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
