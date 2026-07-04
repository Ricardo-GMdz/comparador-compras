import { describe, it, expect, vi } from "vitest";
import { createSupplierSource } from "./supplierSource.js";

// Cliente Anthropic mínimo mockeado: solo messages.create.
function fakeClient(text: string) {
  return {
    messages: {
      create: vi.fn(async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text }],
      })),
    },
  } as never;
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
});
