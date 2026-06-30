import { describe, it, expect } from "vitest";
import type { Offer, Product, Provider } from "../domain/types.js";
import { normalizePrice, rankOffers, compareOffers } from "./index.js";

// Helpers de construcción para mantener los tests legibles (AAA) y DRY.

const TRUSTED_PROVIDER: Provider = { name: "TiendaConfiable", trusted: true };
const UNTRUSTED_PROVIDER: Provider = { name: "Desconocida", trusted: false };

function buildOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    productTitle: "Producto Base",
    provider: TRUSTED_PROVIDER,
    priceAmount: 100,
    currency: "USD",
    region: "global",
    ...overrides,
  };
}

const PRODUCT: Product = { query: "auriculares", region: "global" };

describe("normalizePrice", () => {
  it("redondea el monto a dos decimales sin mutar la oferta original", () => {
    // Arrange
    const offer = buildOffer({ priceAmount: 99.999 });

    // Act
    const result = normalizePrice(offer);

    // Assert
    expect(result.priceAmount).toBe(100);
    expect(offer.priceAmount).toBe(99.999);
    expect(result).not.toBe(offer);
  });

  it("normaliza el código de moneda a mayúsculas y recortado", () => {
    // Arrange
    const offer = buildOffer({ currency: "  usd  " });

    // Act
    const result = normalizePrice(offer);

    // Assert
    expect(result.currency).toBe("USD");
  });

  it("devuelve 0 cuando el monto es negativo", () => {
    // Arrange
    const offer = buildOffer({ priceAmount: -50 });

    // Act
    const result = normalizePrice(offer);

    // Assert
    expect(result.priceAmount).toBe(0);
  });

  it("devuelve 0 cuando el monto no es finito", () => {
    // Arrange
    const offer = buildOffer({ priceAmount: Number.NaN });

    // Act
    const result = normalizePrice(offer);

    // Assert
    expect(result.priceAmount).toBe(0);
  });

  it("preserva el resto de los campos de la oferta", () => {
    // Arrange
    const offer = buildOffer({
      productTitle: "Auriculares Pro",
      url: "https://example.com/p",
      raw: "texto crudo",
      region: "us",
    });

    // Act
    const result = normalizePrice(offer);

    // Assert
    expect(result.productTitle).toBe("Auriculares Pro");
    expect(result.url).toBe("https://example.com/p");
    expect(result.raw).toBe("texto crudo");
    expect(result.region).toBe("us");
    expect(result.provider).toBe(offer.provider);
  });
});

describe("rankOffers", () => {
  it("devuelve un arreglo vacío cuando no hay ofertas", () => {
    // Arrange
    const offers: readonly Offer[] = [];

    // Act
    const result = rankOffers(offers);

    // Assert
    expect(result).toEqual([]);
  });

  it("ordena las ofertas por precio ascendente", () => {
    // Arrange
    const offers = [
      buildOffer({ productTitle: "C", priceAmount: 300 }),
      buildOffer({ productTitle: "A", priceAmount: 100 }),
      buildOffer({ productTitle: "B", priceAmount: 200 }),
    ];

    // Act
    const result = rankOffers(offers);

    // Assert
    expect(result.map((offer) => offer.productTitle)).toEqual(["A", "B", "C"]);
  });

  it("normaliza precios antes de ordenar", () => {
    // Arrange
    const offers = [
      buildOffer({ productTitle: "redondea-arriba", priceAmount: 100.006 }),
      buildOffer({ productTitle: "menor", priceAmount: 99.99 }),
    ];

    // Act
    const result = rankOffers(offers);

    // Assert
    expect(result.map((offer) => offer.productTitle)).toEqual(["menor", "redondea-arriba"]);
    expect(result[1]?.priceAmount).toBe(100.01);
  });

  it("descarta ofertas que no comparten la moneda dominante", () => {
    // Arrange
    const offers = [
      buildOffer({ currency: "USD", priceAmount: 100 }),
      buildOffer({ currency: "USD", priceAmount: 200 }),
      buildOffer({ currency: "EUR", priceAmount: 50 }),
    ];

    // Act
    const result = rankOffers(offers);

    // Assert
    expect(result).toHaveLength(2);
    expect(result.every((offer) => offer.currency === "USD")).toBe(true);
  });

  it("trata como misma moneda los códigos con distinto formato", () => {
    // Arrange
    const offers = [
      buildOffer({ currency: " usd ", priceAmount: 100 }),
      buildOffer({ currency: "USD", priceAmount: 50 }),
    ];

    // Act
    const result = rankOffers(offers);

    // Assert
    expect(result).toHaveLength(2);
    expect(result.map((offer) => offer.priceAmount)).toEqual([50, 100]);
  });

  it("no muta el arreglo de entrada", () => {
    // Arrange
    const offers = [buildOffer({ priceAmount: 300 }), buildOffer({ priceAmount: 100 })];
    const snapshot = offers.map((offer) => offer.priceAmount);

    // Act
    rankOffers(offers);

    // Assert
    expect(offers.map((offer) => offer.priceAmount)).toEqual(snapshot);
  });

  it("descarta ofertas con precio inválido (NaN/negativo) en vez de promoverlas", () => {
    // Arrange: una confiable con precio corrupto que tras el saneo sería 0.
    const offers = [
      buildOffer({ productTitle: "corrupta", priceAmount: Number.NaN }),
      buildOffer({ productTitle: "negativa", priceAmount: -50 }),
      buildOffer({ productTitle: "válida", priceAmount: 100 }),
    ];

    // Act
    const result = rankOffers(offers);

    // Assert: sólo sobrevive la válida; ninguna queda con precio 0.
    expect(result).toHaveLength(1);
    expect(result[0]?.productTitle).toBe("válida");
    expect(result.every((offer) => offer.priceAmount > 0)).toBe(true);
  });

  it("ante empate de monedas elige la moneda con la oferta más barata", () => {
    // Arrange: una oferta por moneda (empate 1-1). EUR tiene el precio menor.
    const offers = [
      buildOffer({ currency: "USD", priceAmount: 999 }),
      buildOffer({ currency: "EUR", priceAmount: 10 }),
    ];

    // Act
    const result = rankOffers(offers);

    // Assert: gana EUR (más barata), no la primera por orden de inserción.
    expect(result).toHaveLength(1);
    expect(result[0]?.currency).toBe("EUR");
    expect(result[0]?.priceAmount).toBe(10);
  });

  it("el desempate de moneda no depende del orden de las ofertas", () => {
    // Arrange: mismas ofertas que el caso anterior, orden invertido.
    const offers = [
      buildOffer({ currency: "EUR", priceAmount: 10 }),
      buildOffer({ currency: "USD", priceAmount: 999 }),
    ];

    // Act
    const result = rankOffers(offers);

    // Assert: resultado determinístico, siempre gana EUR.
    expect(result[0]?.currency).toBe("EUR");
  });
});

describe("compareOffers", () => {
  it("anota una nota y no define best cuando no hay ofertas", () => {
    // Arrange
    const offers: readonly Offer[] = [];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.best).toBeUndefined();
    expect(result.upgradeSuggestion).toBeUndefined();
    expect(result.offers).toEqual([]);
    expect(result.notes).toContain("No se encontraron ofertas comparables");
  });

  it("elige como best la oferta confiable más barata", () => {
    // Arrange
    const offers = [
      buildOffer({ productTitle: "barata", priceAmount: 80 }),
      buildOffer({ productTitle: "media", priceAmount: 120 }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.best?.productTitle).toBe("barata");
    expect(result.best?.priceAmount).toBe(80);
  });

  it("ignora ofertas no confiables al elegir best aunque sean más baratas", () => {
    // Arrange
    const offers = [
      buildOffer({
        productTitle: "sospechosa",
        priceAmount: 10,
        provider: UNTRUSTED_PROVIDER,
      }),
      buildOffer({ productTitle: "confiable", priceAmount: 90 }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.best?.productTitle).toBe("confiable");
  });

  it("no elige como best una oferta confiable con precio inválido", () => {
    // Arrange: confiable con precio corrupto (NaN) + confiable con precio real.
    const offers = [
      buildOffer({ productTitle: "corrupta", priceAmount: Number.NaN }),
      buildOffer({ productTitle: "real", priceAmount: 90 }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert: best es la real, nunca la corrupta promovida a 0.
    expect(result.best?.productTitle).toBe("real");
    expect(result.best?.priceAmount).toBe(90);
  });

  it("no elige como best una oferta confiable con precio negativo", () => {
    // Arrange
    const offers = [
      buildOffer({ productTitle: "negativa", priceAmount: -1 }),
      buildOffer({ productTitle: "real", priceAmount: 75 }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.best?.productTitle).toBe("real");
  });

  it("anota una advertencia cuando no hay proveedores confiables", () => {
    // Arrange
    const offers = [
      buildOffer({ priceAmount: 50, provider: UNTRUSTED_PROVIDER }),
      buildOffer({ priceAmount: 70, provider: UNTRUSTED_PROVIDER }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.best).toBeUndefined();
    expect(result.notes).toContain("confiables");
    expect(result.offers).toHaveLength(2);
  });

  it("sugiere como upgrade la versión de mayor gama confiable dentro del rango de precio", () => {
    // Arrange: best es la gama base (tierRank 0); el candidato es superior y
    // entra en el rango de precio competitivo.
    const offers = [
      buildOffer({
        productTitle: "128GB",
        priceAmount: 100,
        variant: { tierRank: 0, label: "128GB" },
      }),
      buildOffer({
        productTitle: "256GB",
        priceAmount: 140,
        variant: { tierRank: 1, label: "256GB" },
      }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.best?.productTitle).toBe("128GB");
    expect(result.upgradeSuggestion?.productTitle).toBe("256GB");
  });

  it("no sugiere upgrade cuando ninguna oferta es de mayor gama que best", () => {
    // Arrange: ambas son gama base (tierRank 0), aunque una sea más cara.
    const offers = [
      buildOffer({ productTitle: "base-barata", priceAmount: 100 }),
      buildOffer({ productTitle: "base-cara", priceAmount: 120 }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.upgradeSuggestion).toBeUndefined();
  });

  it("no sugiere upgrade cuando la versión superior supera el tope de precio", () => {
    // Arrange: 200 está fuera del rango competitivo respecto de 100.
    const offers = [
      buildOffer({ productTitle: "base", priceAmount: 100, variant: { tierRank: 0 } }),
      buildOffer({ productTitle: "premium", priceAmount: 200, variant: { tierRank: 1 } }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.upgradeSuggestion).toBeUndefined();
  });

  it("elige la versión de mayor gama cuando hay varias superiores en rango", () => {
    // Arrange: dos upgrades dentro del rango; gana el de mayor tierRank.
    const offers = [
      buildOffer({ productTitle: "base", priceAmount: 100, variant: { tierRank: 0 } }),
      buildOffer({ productTitle: "256GB", priceAmount: 130, variant: { tierRank: 1 } }),
      buildOffer({ productTitle: "512GB", priceAmount: 150, variant: { tierRank: 2 } }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.upgradeSuggestion?.productTitle).toBe("512GB");
  });

  it("ante igual gama superior, sugiere la más barata", () => {
    // Arrange: dos ofertas tierRank 1 en rango; gana la más barata.
    const offers = [
      buildOffer({ productTitle: "pro-cara", priceAmount: 150, variant: { tierRank: 1 } }),
      buildOffer({ productTitle: "base", priceAmount: 100, variant: { tierRank: 0 } }),
      buildOffer({ productTitle: "pro-barata", priceAmount: 130, variant: { tierRank: 1 } }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.upgradeSuggestion?.productTitle).toBe("pro-barata");
  });

  it("no sugiere upgrade cuando la versión superior no es confiable", () => {
    // Arrange
    const offers = [
      buildOffer({ productTitle: "base", priceAmount: 100, variant: { tierRank: 0 } }),
      buildOffer({
        productTitle: "pro",
        priceAmount: 130,
        provider: UNTRUSTED_PROVIDER,
        variant: { tierRank: 1 },
      }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.upgradeSuggestion).toBeUndefined();
  });

  it("trata las ofertas sin variant como gama base (tierRank 0)", () => {
    // Arrange: best sin variant (gama base); candidato con tierRank 1 es upgrade.
    const offers = [
      buildOffer({ productTitle: "base-sin-variant", priceAmount: 100 }),
      buildOffer({ productTitle: "pro", priceAmount: 140, variant: { tierRank: 1 } }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.upgradeSuggestion?.productTitle).toBe("pro");
  });

  it("no sugiere upgrade cuando la versión superior cuesta lo mismo que best", () => {
    // Arrange: un upgrade debe costar algo más que la mejor opción; a igual
    // precio no es un "upgrade" sino simplemente otra oferta.
    const offers = [
      buildOffer({ productTitle: "base", priceAmount: 100, variant: { tierRank: 0 } }),
      buildOffer({ productTitle: "pro", priceAmount: 100, variant: { tierRank: 1 } }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.upgradeSuggestion).toBeUndefined();
  });

  it("prefiere como best la oferta nueva sobre una reacondicionada más barata", () => {
    // Arrange
    const offers = [
      buildOffer({ productTitle: "reacondicionada", priceAmount: 80, condition: "refurbished" }),
      buildOffer({ productTitle: "nueva", priceAmount: 100, condition: "new" }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.best?.productTitle).toBe("nueva");
  });

  it("acepta como best una oferta de condición desconocida", () => {
    // Arrange: desconocida (sin condition) más barata que una nueva.
    const offers = [
      buildOffer({ productTitle: "desconocida", priceAmount: 80 }),
      buildOffer({ productTitle: "nueva", priceAmount: 100, condition: "new" }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.best?.productTitle).toBe("desconocida");
  });

  it("elige una reacondicionada como best solo si no hay nuevas, con aviso", () => {
    // Arrange: todas reacondicionadas/usadas.
    const offers = [
      buildOffer({ productTitle: "reacond-barata", priceAmount: 60, condition: "refurbished" }),
      buildOffer({ productTitle: "usada", priceAmount: 70, condition: "used" }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.best?.productTitle).toBe("reacond-barata");
    expect(result.notes).toContain("nueva");
  });

  it("no sugiere como upgrade una oferta reacondicionada", () => {
    // Arrange: best nueva; candidato de mayor gama pero reacondicionado.
    const offers = [
      buildOffer({
        productTitle: "base",
        priceAmount: 100,
        condition: "new",
        variant: { tierRank: 0 },
      }),
      buildOffer({
        productTitle: "pro-reacond",
        priceAmount: 130,
        condition: "refurbished",
        variant: { tierRank: 1 },
      }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.upgradeSuggestion).toBeUndefined();
  });

  it("sugiere como upgrade una versión nueva de mayor gama", () => {
    // Arrange
    const offers = [
      buildOffer({
        productTitle: "base",
        priceAmount: 100,
        condition: "new",
        variant: { tierRank: 0 },
      }),
      buildOffer({
        productTitle: "pro",
        priceAmount: 130,
        condition: "new",
        variant: { tierRank: 1 },
      }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.upgradeSuggestion?.productTitle).toBe("pro");
  });

  it("devuelve las ofertas ya ordenadas por precio", () => {
    // Arrange
    const offers = [
      buildOffer({ productTitle: "cara", priceAmount: 300 }),
      buildOffer({ productTitle: "barata", priceAmount: 100 }),
    ];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.offers.map((offer) => offer.priceAmount)).toEqual([100, 300]);
  });

  it("conserva el producto recibido en el resultado", () => {
    // Arrange
    const offers = [buildOffer({ priceAmount: 100 })];

    // Act
    const result = compareOffers(PRODUCT, offers);

    // Assert
    expect(result.product).toBe(PRODUCT);
  });
});
