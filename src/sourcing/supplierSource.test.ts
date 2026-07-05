import { describe, it, expect, vi } from "vitest";
import { createSupplierSource } from "./supplierSource.js";

// Cliente Anthropic mínimo mockeado: solo messages.create.
// Devuelve los textos en orden (uno por llamada); repite el último si se agotan.
function fakeClientSequence(texts: readonly string[]) {
  let call = 0;
  const create = vi.fn(async () => {
    const text = texts[Math.min(call, texts.length - 1)] ?? "";
    call += 1;
    return {
      stop_reason: "end_turn",
      content: [{ type: "text", text }],
    };
  });
  return { client: { messages: { create } } as never, create };
}

function fakeClient(text: string) {
  return fakeClientSequence([text]).client;
}

const RESPONSE = JSON.stringify({
  suppliers: [
    {
      name: "Aceros del Norte",
      website: "https://aceros.mx",
      material: "lámina",
      wholesalePrice: 180,
      currency: "MXN",
      contact: { email: "v@aceros.mx" },
      trusted: true,
    },
  ],
});

describe("createSupplierSource", () => {
  it("busca proveedores y los mapea a SupplierCandidate", async () => {
    const source = createSupplierSource({ client: fakeClient(RESPONSE) });
    const result = await source.search({ query: "lámina galvanizada", region: "mx" });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "Aceros del Norte",
      region: "mx",
      wholesalePrice: 180,
    });
  });

  it("devuelve [] cuando el modelo no da texto utilizable", async () => {
    const source = createSupplierSource({ client: fakeClient("") });
    const result = await source.search({ query: "x", region: "mx" });
    expect(result).toEqual([]);
  });

  describe("reintento si la búsqueda viene vacía", () => {
    const EMPTY = JSON.stringify({ suppliers: [] });

    it("reintenta una vez cuando la primera búsqueda devuelve 0 proveedores", async () => {
      // Arrange: primera vacía, segunda con resultados
      const { client, create } = fakeClientSequence([EMPTY, RESPONSE]);
      const source = createSupplierSource({ client });

      // Act
      const result = await source.search({ query: "lámina", region: "mx" });

      // Assert
      expect(create).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("Aceros del Norte");
    });

    it("devuelve [] con exactamente 2 llamadas cuando ambas búsquedas vienen vacías", async () => {
      const { client, create } = fakeClientSequence([EMPTY, EMPTY]);
      const source = createSupplierSource({ client });

      const result = await source.search({ query: "x", region: "mx" });

      expect(create).toHaveBeenCalledTimes(2);
      expect(result).toEqual([]);
    });

    it("hace una sola llamada cuando la primera búsqueda trae resultados", async () => {
      const { client, create } = fakeClientSequence([RESPONSE]);
      const source = createSupplierSource({ client });

      const result = await source.search({ query: "lámina", region: "mx" });

      expect(create).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
    });
  });
});
