// Smoke test del slice vertical end-to-end.
//
// Ejercita la integración real entre las piezas del flujo "comparar":
//   ProductSource (mockeada, sin red) -> runComparison -> compareOffers ->
//   renderComparison.
//
// A diferencia de los tests unitarios, aquí NO se mockean compareOffers ni el
// render: solo se sustituye la fuente por una falsa para no tocar la red ni el
// SDK de Anthropic. El objetivo es confirmar que el cableado encaja y produce
// una salida coherente con al menos una oferta.

import { describe, it, expect } from "vitest";

import type { Offer } from "../domain/types.js";
import type { ProductSource } from "../domain/source.js";
import { runComparison } from "./runner.js";
import { renderComparison } from "../cli/render.js";

// Identificador de la fuente falsa usada en el smoke test.
const FAKE_SOURCE_ID = "fake-source";

/** Construye una oferta de prueba con valores por defecto razonables. */
function buildOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    productTitle: "Notebook 16GB RAM",
    provider: { name: "TiendaConfiable", trusted: true },
    priceAmount: 1000,
    currency: "USD",
    region: "global",
    ...overrides,
  };
}

/** Crea una `ProductSource` falsa que devuelve las ofertas indicadas sin red. */
function createFakeSource(offers: readonly Offer[]): ProductSource {
  return {
    id: FAKE_SOURCE_ID,
    search: async () => offers,
  };
}

describe("slice vertical comparar (smoke)", () => {
  it("produce un ComparisonResult con >=1 oferta y lo renderiza coherentemente", async () => {
    // Arrange: dos ofertas confiables en la misma moneda; la más barata debería
    // ser la mejor y la más cara (dentro del rango) un upgrade sugerido.
    const cheaper = buildOffer({
      productTitle: "Notebook 16GB RAM",
      priceAmount: 1000,
    });
    const pricier = buildOffer({
      productTitle: "Notebook 16GB RAM Pro",
      provider: { name: "OtraTiendaConfiable", trusted: true },
      priceAmount: 1150,
    });
    const source = createFakeSource([pricier, cheaper]);

    // Act: corremos el flujo real (runner + compare) y renderizamos.
    const result = await runComparison({
      query: "notebook 16GB RAM",
      region: "us",
      sources: [source],
    });
    const output = renderComparison(result);

    // Assert: el resultado refleja el producto y trae al menos una oferta.
    expect(result.product).toEqual({ query: "notebook 16GB RAM", region: "us" });
    expect(result.offers.length).toBeGreaterThanOrEqual(1);

    // La mejor opción es la oferta confiable más barata.
    expect(result.best?.priceAmount).toBe(1000);
    expect(result.best?.productTitle).toBe("Notebook 16GB RAM");

    // El render incluye encabezado, la tabla con precios y la recomendación.
    expect(output).toContain("notebook 16GB RAM");
    expect(output).toContain("us");
    expect(output).toContain("1000 USD");
    expect(output).toContain("Mejor opción:");
  });

  it("informa explícitamente cuando la fuente no devuelve ofertas", async () => {
    // Arrange: fuente que no encuentra nada (sin red).
    const source = createFakeSource([]);

    // Act
    const result = await runComparison({
      query: "producto inexistente",
      region: "global",
      sources: [source],
    });
    const output = renderComparison(result);

    // Assert: sin ofertas, el render lo comunica de forma explícita.
    expect(result.offers).toHaveLength(0);
    expect(result.best).toBeUndefined();
    expect(output).toContain("No se encontraron ofertas.");
  });
});
