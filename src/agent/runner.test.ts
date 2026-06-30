import { describe, it, expect, vi, beforeEach } from "vitest";

import type { Offer, ComparisonResult } from "../domain/types.js";
import type { ProductSource } from "../domain/source.js";

// Se mockean las dependencias colaboradoras para aislar la orquestación del
// runner: no se prueba aquí la lógica de comparación ni el logger reales.
import { compareOffers } from "../compare/index.js";
import { logger } from "../logging/logger.js";
import { runComparison } from "./runner.js";

vi.mock("../compare/index.js", () => ({
  compareOffers: vi.fn(),
}));

vi.mock("../logging/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const compareOffersMock = vi.mocked(compareOffers);
const loggerMock = vi.mocked(logger);

/** Construye una oferta de prueba con valores por defecto razonables. */
function makeOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    productTitle: "Producto de prueba",
    provider: { name: "Tienda", trusted: true },
    priceAmount: 100,
    currency: "USD",
    region: "global",
    ...overrides,
  };
}

/** Crea una fuente falsa que devuelve las ofertas indicadas. */
function makeFakeSource(id: string, offers: readonly Offer[]): ProductSource {
  return {
    id,
    search: vi.fn(async () => offers),
  };
}

/** Crea una fuente falsa que siempre falla al buscar. */
function makeFailingSource(id: string, error: Error): ProductSource {
  return {
    id,
    search: vi.fn(async () => {
      throw error;
    }),
  };
}

describe("runComparison", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Por defecto, compareOffers devuelve un resultado vacío predecible.
    compareOffersMock.mockImplementation((product, offers) => ({
      product,
      offers,
    }));
  });

  it("construye el Product a partir de query y region recibidos", async () => {
    // Arrange
    const source = makeFakeSource("uno", []);

    // Act
    await runComparison({ query: "teléfono", region: "us", sources: [source] });

    // Assert
    expect(compareOffersMock).toHaveBeenCalledWith(
      { query: "teléfono", region: "us" },
      expect.any(Array),
    );
    expect(source.search).toHaveBeenCalledWith({
      query: "teléfono",
      region: "us",
    });
  });

  it("junta las ofertas de todas las fuentes en una sola lista", async () => {
    // Arrange
    const offerA = makeOffer({ productTitle: "A" });
    const offerB = makeOffer({ productTitle: "B" });
    const offerC = makeOffer({ productTitle: "C" });
    const sources = [makeFakeSource("uno", [offerA]), makeFakeSource("dos", [offerB, offerC])];

    // Act
    await runComparison({ query: "x", region: "global", sources });

    // Assert
    const [, collectedOffers] = compareOffersMock.mock.calls[0];
    expect(collectedOffers).toEqual([offerA, offerB, offerC]);
  });

  it("devuelve el ComparisonResult producido por compareOffers", async () => {
    // Arrange
    const offer = makeOffer();
    const expected: ComparisonResult = {
      product: { query: "x", region: "global" },
      offers: [offer],
      best: offer,
    };
    compareOffersMock.mockReturnValueOnce(expected);

    // Act
    const result = await runComparison({
      query: "x",
      region: "global",
      sources: [makeFakeSource("uno", [offer])],
    });

    // Assert
    expect(result).toBe(expected);
  });

  it("continúa con las demás fuentes cuando una falla", async () => {
    // Arrange
    const offerOk = makeOffer({ productTitle: "OK" });
    const sources = [
      makeFailingSource("rota", new Error("timeout de red")),
      makeFakeSource("sana", [offerOk]),
    ];

    // Act
    await runComparison({ query: "x", region: "global", sources });

    // Assert: la oferta de la fuente sana se conserva pese al fallo de la otra.
    const [, collectedOffers] = compareOffersMock.mock.calls[0];
    expect(collectedOffers).toEqual([offerOk]);
  });

  it("registra el error con contexto cuando una fuente falla", async () => {
    // Arrange
    const error = new Error("timeout de red");
    const sources = [makeFailingSource("rota", error)];

    // Act
    await runComparison({ query: "x", region: "us", sources });

    // Assert
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        sourceId: "rota",
        query: "x",
        region: "us",
        reason: "timeout de red",
      }),
    );
  });

  it("no registra errores cuando todas las fuentes funcionan", async () => {
    // Arrange
    const sources = [makeFakeSource("uno", [makeOffer()])];

    // Act
    await runComparison({ query: "x", region: "global", sources });

    // Assert
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it("devuelve una lista vacía de ofertas cuando no hay fuentes", async () => {
    // Arrange
    const sources: readonly ProductSource[] = [];

    // Act
    await runComparison({ query: "x", region: "global", sources });

    // Assert
    const [, collectedOffers] = compareOffersMock.mock.calls[0];
    expect(collectedOffers).toEqual([]);
  });
});
