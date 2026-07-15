import { describe, it, expect, vi } from "vitest";
import { createSupplierSource } from "./supplierSource.js";
import type { Supplier } from "../domain/supplier.js";

// Cliente Anthropic mínimo mockeado: solo messages.create.
// Devuelve los textos en orden (uno por llamada); repite el último si se agotan.
function fakeClientSequence(texts: readonly string[]) {
  let call = 0;
  const create = vi.fn(async (_params: unknown) => {
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

  describe("enrichContact", () => {
    const NOW = "2026-07-01T00:00:00.000Z";

    /** Proveedor persistido base para los tests de enriquecimiento. */
    function makeSupplier(overrides: Partial<Supplier> = {}): Supplier {
      return {
        name: "Aceros del Norte",
        website: "https://aceros.mx",
        material: "lámina",
        region: "mx",
        trusted: true,
        contact: {},
        status: "pendiente",
        firstSeen: NOW,
        lastSeen: NOW,
        ...overrides,
      };
    }

    const CONTACT_RESPONSE = JSON.stringify({
      contact: { email: "ventas@aceros.mx", phone: "+52 81 1234 5678" },
    });

    it("llama al modelo con la web del proveedor y devuelve el contacto encontrado", async () => {
      const { client, create } = fakeClientSequence([CONTACT_RESPONSE]);
      const source = createSupplierSource({ client });

      const contact = await source.enrichContact(makeSupplier());

      expect(create).toHaveBeenCalledTimes(1);
      // El prompt de usuario menciona la web a visitar.
      const call = create.mock.calls[0]?.[0] as { messages: { content: string }[] };
      expect(call.messages[0]?.content).toContain("https://aceros.mx");
      expect(contact).toEqual({ email: "ventas@aceros.mx", phone: "+52 81 1234 5678" });
    });

    it("devuelve SOLO los campos faltantes (no pisa los que el proveedor ya tiene)", async () => {
      // Arrange: el proveedor ya tiene email; la respuesta trae email y phone.
      const { client } = fakeClientSequence([CONTACT_RESPONSE]);
      const source = createSupplierSource({ client });
      const supplier = makeSupplier({ contact: { email: "existente@aceros.mx" } });

      // Act
      const contact = await source.enrichContact(supplier);

      // Assert: el email de la respuesta se ignora; solo entra el phone.
      expect(contact).toEqual({ phone: "+52 81 1234 5678" });
    });

    it("devuelve {} cuando el modelo no da texto utilizable", async () => {
      const { client } = fakeClientSequence([""]);
      const source = createSupplierSource({ client });

      const contact = await source.enrichContact(makeSupplier());

      expect(contact).toEqual({});
    });

    it("devuelve {} sin llamar al modelo cuando el proveedor no tiene website", async () => {
      const { client, create } = fakeClientSequence([CONTACT_RESPONSE]);
      const source = createSupplierSource({ client });

      const contact = await source.enrichContact(makeSupplier({ website: undefined }));

      expect(create).not.toHaveBeenCalled();
      expect(contact).toEqual({});
    });
  });
});

describe("createSupplierSource — searchBudget", () => {
  const emptyJson = JSON.stringify({ suppliers: [] });

  // Forma mínima de los argumentos de messages.create que asertamos.
  type CreateArgs = {
    max_tokens: number;
    thinking: unknown;
    output_config?: unknown;
    tools: { max_uses: number }[];
  };

  it("sin searchBudget usa los defaults (adaptive sin effort, 5 usos, 1 reintento)", async () => {
    const { client, create } = fakeClientSequence([emptyJson]);
    const source = createSupplierSource({ client });
    await source.search({ query: "láminas", region: "mx" });
    // Vacío + default → reintenta: 2 llamadas.
    expect(create).toHaveBeenCalledTimes(2);
    const args = create.mock.calls[0]?.[0] as CreateArgs;
    expect(args.thinking).toEqual({ type: "adaptive" });
    expect(args.output_config).toBeUndefined();
    expect(args.tools[0]?.max_uses).toBe(5);
  });

  it("con searchBudget usa thinking adaptive + output_config.effort y NO reintenta si maxEmptyRetries=0", async () => {
    const { client, create } = fakeClientSequence([emptyJson]);
    const source = createSupplierSource({
      client,
      searchBudget: {
        maxWebSearchUses: 2,
        maxEmptyRetries: 0,
        maxTokens: 8000,
        effort: "low",
      },
    });
    await source.search({ query: "láminas", region: "mx" });
    // maxEmptyRetries=0 → una sola llamada aunque venga vacío.
    expect(create).toHaveBeenCalledTimes(1);
    const args = create.mock.calls[0]?.[0] as CreateArgs;
    // El modelo (opus 4.8) NO soporta thinking "enabled": adaptive + effort.
    expect(args.thinking).toEqual({ type: "adaptive" });
    expect(args.output_config).toEqual({ effort: "low" });
    expect(args.max_tokens).toBe(8000);
    expect(args.tools[0]?.max_uses).toBe(2);
  });
});
