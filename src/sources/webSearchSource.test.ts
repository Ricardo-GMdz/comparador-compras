// Tests de la fuente web-search con el cliente del SDK mockeado (sin red).
// Verifican: id estable, mapeo de ofertas, manejo de respuestas vacías,
// validación de esquema y propagación explícita de errores de red/SDK.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock del SDK: el default export es una clase cuyo `messages.create` controlamos
// por test a través de `createMock`. Así evitamos cualquier llamada real de red.
const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    public readonly messages = { create: createMock };
    public constructor(_opts: { apiKey: string }) {
      // No hace nada: solo simula la firma del constructor del SDK.
    }
  }
  return { default: FakeAnthropic };
});

// Import después del mock para que tome la versión mockeada del SDK.
import { createWebSearchSource, WEB_SEARCH_SOURCE_ID } from "./webSearchSource.js";
import type { Product } from "../domain/types.js";

// Helper: arma una respuesta del modelo con un único bloque de texto.
function textResponse(text: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text }] };
}

const PRODUCT: Product = { query: "teclado mecánico", region: "us" };

describe("createWebSearchSource", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("expone el id estable 'web-search'", () => {
    // Arrange & Act
    const source = createWebSearchSource({ apiKey: "test-key" });

    // Assert
    expect(source.id).toBe(WEB_SEARCH_SOURCE_ID);
  });

  it("lanza un error cuando la apiKey está vacía", () => {
    // Arrange, Act & Assert
    expect(() => createWebSearchSource({ apiKey: "   " })).toThrow(/apiKey/);
  });

  it("mapea la respuesta JSON del modelo a ofertas normalizadas", async () => {
    // Arrange
    const json = JSON.stringify([
      {
        productTitle: "Teclado mecánico RGB",
        provider: { name: "TiendaX", trusted: true },
        priceAmount: "$99,90",
        currency: "usd",
      },
    ]);
    createMock.mockResolvedValue(textResponse(json));
    const source = createWebSearchSource({ apiKey: "test-key" });

    // Act
    const offers = await source.search(PRODUCT);

    // Assert
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      productTitle: "Teclado mecánico RGB",
      priceAmount: 99.9,
      currency: "USD",
      region: "us",
      provider: { name: "TiendaX", trusted: true },
    });
  });

  it("extrae el arreglo JSON aunque venga envuelto en prosa", async () => {
    // Arrange
    const wrapped =
      'Acá tenés las ofertas:\n[{"productTitle":"X","provider":{"name":"T"},"priceAmount":10,"currency":"USD"}]\nEso es todo.';
    createMock.mockResolvedValue(textResponse(wrapped));
    const source = createWebSearchSource({ apiKey: "test-key" });

    // Act
    const offers = await source.search(PRODUCT);

    // Assert
    expect(offers).toHaveLength(1);
    expect(offers[0]?.priceAmount).toBe(10);
  });

  it("devuelve un arreglo vacío cuando el modelo no devuelve texto", async () => {
    // Arrange
    createMock.mockResolvedValue({ content: [] });
    const source = createWebSearchSource({ apiKey: "test-key" });

    // Act
    const offers = await source.search(PRODUCT);

    // Assert
    expect(offers).toEqual([]);
  });

  it("devuelve un arreglo vacío cuando el modelo responde con []", async () => {
    // Arrange
    createMock.mockResolvedValue(textResponse("[]"));
    const source = createWebSearchSource({ apiKey: "test-key" });

    // Act
    const offers = await source.search(PRODUCT);

    // Assert
    expect(offers).toEqual([]);
  });

  it("descarta ofertas cuyo precio no es interpretable", async () => {
    // Arrange
    const json = JSON.stringify([
      { productTitle: "Válida", provider: { name: "A" }, priceAmount: 10, currency: "USD" },
      {
        productTitle: "Inválida",
        provider: { name: "B" },
        priceAmount: "consultar",
        currency: "USD",
      },
    ]);
    createMock.mockResolvedValue(textResponse(json));
    const source = createWebSearchSource({ apiKey: "test-key" });

    // Act
    const offers = await source.search(PRODUCT);

    // Assert
    expect(offers).toHaveLength(1);
    expect(offers[0]?.productTitle).toBe("Válida");
  });

  it("descarta una oferta malformada y conserva las válidas del mismo arreglo", async () => {
    // Arrange: la segunda oferta no tiene `currency` (requerido); la otra sí.
    const json = JSON.stringify([
      { productTitle: "Válida", provider: { name: "A" }, priceAmount: 10, currency: "USD" },
      { productTitle: "Sin moneda", provider: { name: "B" }, priceAmount: 20 },
    ]);
    createMock.mockResolvedValue(textResponse(json));
    const source = createWebSearchSource({ apiKey: "test-key" });

    // Act
    const offers = await source.search(PRODUCT);

    // Assert: no se aborta toda la fuente; sobrevive la oferta válida.
    expect(offers).toHaveLength(1);
    expect(offers[0]?.productTitle).toBe("Válida");
  });

  it("lanza un error cuando la respuesta JSON no es un arreglo", async () => {
    // Arrange: el modelo devuelve un objeto, no un arreglo de ofertas.
    const json = JSON.stringify({ productTitle: "Suelta", currency: "USD" });
    createMock.mockResolvedValue(textResponse(json));
    const source = createWebSearchSource({ apiKey: "test-key" });

    // Act & Assert
    await expect(source.search(PRODUCT)).rejects.toThrow(/arreglo/);
  });

  it("reanuda el turno cuando el server tool devuelve pause_turn", async () => {
    // Arrange: primer respuesta pausada, segunda con las ofertas.
    const finalJson = JSON.stringify([
      { productTitle: "Reanudada", provider: { name: "A" }, priceAmount: 10, currency: "USD" },
    ]);
    createMock
      .mockResolvedValueOnce({ stop_reason: "pause_turn", content: [{ type: "text", text: "" }] })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: finalJson }],
      });
    const source = createWebSearchSource({ apiKey: "test-key" });

    // Act
    const offers = await source.search(PRODUCT);

    // Assert: se hizo una segunda llamada y se recuperaron las ofertas.
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(offers).toHaveLength(1);
    expect(offers[0]?.productTitle).toBe("Reanudada");
  });

  it("lanza un error cuando el texto del modelo no es JSON parseable", async () => {
    // Arrange
    createMock.mockResolvedValue(textResponse("no soy json"));
    const source = createWebSearchSource({ apiKey: "test-key" });

    // Act & Assert
    await expect(source.search(PRODUCT)).rejects.toThrow(/no parseable|JSON/);
  });

  it("propaga de forma explícita los errores de red/SDK", async () => {
    // Arrange
    createMock.mockRejectedValue(new Error("timeout de red"));
    const source = createWebSearchSource({ apiKey: "test-key" });

    // Act & Assert
    await expect(source.search(PRODUCT)).rejects.toThrow(/error consultando el modelo/);
  });

  it("invoca al SDK con el modelo y el server tool web_search", async () => {
    // Arrange
    createMock.mockResolvedValue(textResponse("[]"));
    const source = createWebSearchSource({ apiKey: "test-key" });

    // Act
    await source.search(PRODUCT);

    // Assert
    expect(createMock).toHaveBeenCalledTimes(1);
    const callArg = createMock.mock.calls[0]?.[0] as {
      model: string;
      thinking: { type: string };
      tools: Array<{ type: string; name: string }>;
    };
    expect(callArg.model).toBe("claude-opus-4-8");
    expect(callArg.thinking).toEqual({ type: "adaptive" });
    expect(callArg.tools[0]).toMatchObject({
      type: "web_search_20260209",
      name: "web_search",
    });
  });
});
