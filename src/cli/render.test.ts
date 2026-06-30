// Tests del render de la comparación: verifican que el texto generado
// contenga la información clave de las ofertas y las recomendaciones.

import { describe, it, expect } from "vitest";
import type { ComparisonResult, Offer, Provider } from "../domain/types.js";

import { renderComparison } from "./render.js";

const TRUSTED_PROVIDER: Provider = { name: "TiendaConfiable", trusted: true };
const UNTRUSTED_PROVIDER: Provider = { name: "TiendaDesconocida", trusted: false };

/** Construye una oferta de prueba con valores por defecto razonables. */
function buildOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    productTitle: "Notebook X",
    provider: TRUSTED_PROVIDER,
    priceAmount: 1000,
    currency: "USD",
    region: "global",
    ...overrides,
  };
}

describe("renderComparison", () => {
  it("incluye el producto y la región en el encabezado", () => {
    // Arrange
    const result: ComparisonResult = {
      product: { query: "notebook", region: "us" },
      offers: [buildOffer()],
    };

    // Act
    const output = renderComparison(result);

    // Assert
    expect(output).toContain("notebook");
    expect(output).toContain("us");
  });

  it("informa explícitamente cuando no hay ofertas", () => {
    // Arrange
    const result: ComparisonResult = {
      product: { query: "producto raro", region: "global" },
      offers: [],
    };

    // Act
    const output = renderComparison(result);

    // Assert
    expect(output).toContain("No se encontraron ofertas.");
  });

  it("muestra el precio y la moneda de cada oferta", () => {
    // Arrange
    const result: ComparisonResult = {
      product: { query: "notebook", region: "global" },
      offers: [buildOffer({ priceAmount: 1234, currency: "EUR" })],
    };

    // Act
    const output = renderComparison(result);

    // Assert
    expect(output).toContain("1234 EUR");
  });

  it("incluye la mejor opción cuando está presente", () => {
    // Arrange
    const best = buildOffer({ productTitle: "Notebook Pro", priceAmount: 900 });
    const result: ComparisonResult = {
      product: { query: "notebook", region: "global" },
      offers: [best],
      best,
    };

    // Act
    const output = renderComparison(result);

    // Assert
    expect(output).toContain("Mejor opción:");
    expect(output).toContain("Notebook Pro");
  });

  it("incluye la sugerencia de upgrade cuando está presente", () => {
    // Arrange
    const upgrade = buildOffer({
      productTitle: "Notebook Ultra",
      priceAmount: 1100,
      provider: UNTRUSTED_PROVIDER,
    });
    const result: ComparisonResult = {
      product: { query: "notebook", region: "global" },
      offers: [buildOffer(), upgrade],
      upgradeSuggestion: upgrade,
    };

    // Act
    const output = renderComparison(result);

    // Assert
    expect(output).toContain("Upgrade sugerido:");
    expect(output).toContain("Notebook Ultra");
  });

  it("muestra la condición de cada oferta en la tabla", () => {
    // Arrange
    const result: ComparisonResult = {
      product: { query: "notebook", region: "global" },
      offers: [buildOffer({ condition: "refurbished" })],
    };

    // Act
    const output = renderComparison(result);

    // Assert
    expect(output).toContain("Condición");
    expect(output).toContain("Reacond.");
  });

  it("muestra '—' cuando la condición de una oferta es desconocida", () => {
    // Arrange: sin condition => desconocida.
    const result: ComparisonResult = {
      product: { query: "notebook", region: "global" },
      offers: [buildOffer()],
    };

    // Act
    const output = renderComparison(result);

    // Assert
    expect(output).toContain("—");
  });

  it("muestra el label de la variante en la sugerencia de upgrade", () => {
    // Arrange: el label ("256GB") no está en el título, así que sólo aparece
    // en la salida si el render efectivamente lo incluye.
    const upgrade = buildOffer({
      productTitle: "iPhone variante superior",
      priceAmount: 1400,
      variant: { tierRank: 1, label: "256GB" },
    });
    const result: ComparisonResult = {
      product: { query: "iphone", region: "global" },
      offers: [buildOffer(), upgrade],
      upgradeSuggestion: upgrade,
    };

    // Act
    const output = renderComparison(result);

    // Assert
    expect(output).toContain("256GB");
  });
});
