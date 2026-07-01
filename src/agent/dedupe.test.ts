// Tests del deduplicado de ofertas combinadas de varias fuentes (AAA).

import { describe, it, expect } from "vitest";
import type { Offer, Product, Provider } from "../domain/types.js";
import { dedupeOffers } from "./dedupe.js";
import { compareOffers } from "../compare/index.js";

const PROVIDER_A: Provider = { name: "TiendaA", trusted: true };
const PROVIDER_B: Provider = { name: "TiendaB", trusted: true };

function buildOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    productTitle: "Producto X",
    provider: PROVIDER_A,
    priceAmount: 100,
    currency: "USD",
    region: "global",
    ...overrides,
  };
}

describe("dedupeOffers", () => {
  it("fusiona ofertas duplicadas (mismo proveedor, título y moneda) y conserva la más barata", () => {
    // Arrange: la misma oferta reportada por dos fuentes con precios distintos.
    const offers = [buildOffer({ priceAmount: 120 }), buildOffer({ priceAmount: 100 })];

    // Act
    const result = dedupeOffers(offers);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.priceAmount).toBe(100);
  });

  it("no fusiona ofertas de distinto proveedor", () => {
    // Arrange
    const offers = [buildOffer({ provider: PROVIDER_A }), buildOffer({ provider: PROVIDER_B })];

    // Act
    const result = dedupeOffers(offers);

    // Assert
    expect(result).toHaveLength(2);
  });

  it("no fusiona ofertas del mismo título pero distinta condición", () => {
    // Arrange: nueva vs reacondicionada del mismo producto son ofertas distintas.
    const offers = [buildOffer({ condition: "new" }), buildOffer({ condition: "refurbished" })];

    // Act
    const result = dedupeOffers(offers);

    // Assert
    expect(result).toHaveLength(2);
  });

  it("no fusiona ofertas del mismo título pero distinta variante (tierRank)", () => {
    // Arrange: dos gamas del mismo producto (128GB gama base vs 256GB superior)
    // con idéntico título, moneda y condición pero distinto tierRank. Son
    // ofertas distintas: sin el tierRank en la clave, la superior se perdería.
    const offers = [
      buildOffer({ priceAmount: 900, variant: { tierRank: 0, label: "128GB" } }),
      buildOffer({ priceAmount: 1100, variant: { tierRank: 1, label: "256GB" } }),
    ];

    // Act
    const result = dedupeOffers(offers);

    // Assert: se conservan ambas gamas.
    expect(result).toHaveLength(2);
    const tiers = result.map((offer) => offer.variant?.tierRank).sort();
    expect(tiers).toEqual([0, 1]);
  });

  it("trata la ausencia de variante como gama base al deduplicar", () => {
    // Arrange: una sin variante (gama base) y otra con tierRank 0 explícito son
    // la misma gama; deben fusionarse conservando la más barata.
    const offers = [
      buildOffer({ priceAmount: 120 }),
      buildOffer({ priceAmount: 100, variant: { tierRank: 0 } }),
    ];

    // Act
    const result = dedupeOffers(offers);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.priceAmount).toBe(100);
  });

  it("normaliza proveedor, título y moneda al comparar (espacios/mayúsculas)", () => {
    // Arrange: mismas ofertas con formato distinto deben considerarse iguales.
    const offers = [
      buildOffer({
        productTitle: "Producto X",
        provider: { name: "TiendaA", trusted: true },
        currency: "USD",
      }),
      buildOffer({
        productTitle: "  producto x  ",
        provider: { name: "  TIENDAA ", trusted: true },
        currency: "usd",
        priceAmount: 90,
      }),
    ];

    // Act
    const result = dedupeOffers(offers);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.priceAmount).toBe(90);
  });

  it("conserva una sola entre tres duplicados, la de menor precio", () => {
    // Arrange
    const offers = [
      buildOffer({ priceAmount: 130 }),
      buildOffer({ priceAmount: 110 }),
      buildOffer({ priceAmount: 125 }),
    ];

    // Act
    const result = dedupeOffers(offers);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.priceAmount).toBe(110);
  });

  it("tras dedupe+compare, la sugerencia de upgrade sobrevive (regresión de identidad por variante)", () => {
    // Arrange: dos gamas del mismo producto con idéntico título/moneda/condición.
    // Antes, el dedupe las colapsaba y compare perdía la candidata a upgrade.
    const product: Product = { query: "celular", region: "global" };
    const offers = [
      buildOffer({
        priceAmount: 900,
        condition: "new",
        variant: { tierRank: 0, label: "128GB" },
      }),
      buildOffer({
        priceAmount: 1100,
        condition: "new",
        variant: { tierRank: 1, label: "256GB" },
      }),
    ];

    // Act: reproducimos el flujo del runner (dedupe antes de comparar).
    const result = compareOffers(product, dedupeOffers(offers));

    // Assert: el best es la gama base y la superior sobrevive como upgrade.
    expect(result.best?.variant?.tierRank).toBe(0);
    expect(result.upgradeSuggestion?.variant?.tierRank).toBe(1);
    expect(result.upgradeSuggestion?.priceAmount).toBe(1100);
  });

  it("no muta el arreglo de entrada", () => {
    // Arrange
    const offers = [buildOffer({ priceAmount: 120 }), buildOffer({ priceAmount: 100 })];
    const snapshot = offers.map((offer) => offer.priceAmount);

    // Act
    dedupeOffers(offers);

    // Assert
    expect(offers.map((offer) => offer.priceAmount)).toEqual(snapshot);
  });
});
