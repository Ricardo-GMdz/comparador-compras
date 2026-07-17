import { describe, it, expect, vi } from "vitest";
import { createSupplierSource, buildQueryVariants } from "./supplierSource.js";
import type { Supplier } from "../domain/supplier.js";

// Cliente Anthropic mínimo mockeado: solo messages.create.
// Un resultado por llamada, en orden: texto de respuesta o rechazo (error).
// Repite el último resultado si se agotan.
type FakeOutcome = { text: string } | { reject: string };

function fakeClientOutcomes(outcomes: readonly FakeOutcome[]) {
  let call = 0;
  const create = vi.fn(async (_params: unknown) => {
    const outcome = outcomes[Math.min(call, outcomes.length - 1)] ?? { text: "" };
    call += 1;
    if ("reject" in outcome) {
      throw new Error(outcome.reject);
    }
    return {
      stop_reason: "end_turn",
      content: [{ type: "text", text: outcome.text }],
    };
  });
  return { client: { messages: { create } } as never, create };
}

function fakeClientSequence(texts: readonly string[]) {
  return fakeClientOutcomes(texts.map((text) => ({ text })));
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

  describe("fan-out de variantes", () => {
    const EMPTY = JSON.stringify({ suppliers: [] });
    // Otro proveedor (web distinta → supplierKey distinto al de RESPONSE).
    const OTHER_RESPONSE = JSON.stringify({
      suppliers: [
        { name: "Ferretera MTY", website: "https://ferretera.mx", material: "lámina" },
      ],
    });

    it("dispara una llamada por variante y cada prompt lleva su variante", async () => {
      // Arrange
      const { client, create } = fakeClientOutcomes([
        { text: RESPONSE },
        { text: EMPTY },
        { text: EMPTY },
      ]);
      const source = createSupplierSource({ client });

      // Act
      await source.search({ query: "lámina galvanizada", region: "mx" });

      // Assert: 3 llamadas (default) y los prompts interpolan cada variante.
      expect(create).toHaveBeenCalledTimes(3);
      type Call = { messages: { content: string }[] };
      const prompts = create.mock.calls.map((c) => (c[0] as Call).messages[0]?.content ?? "");
      expect(prompts[0]).toContain('"lámina galvanizada"');
      expect(prompts[1]).toContain('"distribuidor mayorista de lámina galvanizada en México"');
      expect(prompts[2]).toContain('"proveedores de lámina galvanizada al por mayor"');
    });

    it("combina los resultados y deduplica por supplierKey (el primero gana)", async () => {
      // Arrange: variantes 1 y 2 devuelven el MISMO proveedor (misma web); la 3, otro.
      const { client } = fakeClientOutcomes([
        { text: RESPONSE },
        { text: RESPONSE },
        { text: OTHER_RESPONSE },
      ]);
      const source = createSupplierSource({ client });

      // Act
      const result = await source.search({ query: "lámina", region: "mx" });

      // Assert: 2 únicos, sin duplicar Aceros del Norte.
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.name).sort()).toEqual(["Aceros del Norte", "Ferretera MTY"]);
    });

    it("una variante que falla no tumba el resultado (se usan las otras)", async () => {
      const { client } = fakeClientOutcomes([
        { reject: "boom" },
        { text: RESPONSE },
        { text: EMPTY },
      ]);
      const source = createSupplierSource({ client });

      const result = await source.search({ query: "lámina", region: "mx" });

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("Aceros del Norte");
    });

    it("propaga un error cuando TODAS las variantes fallan", async () => {
      const { client } = fakeClientOutcomes([
        { reject: "boom" },
        { reject: "boom" },
        { reject: "boom" },
      ]);
      const source = createSupplierSource({ client });

      await expect(source.search({ query: "x", region: "mx" })).rejects.toThrow("boom");
    });

    it("devuelve [] cuando todas las variantes vienen vacías", async () => {
      const { client } = fakeClientOutcomes([{ text: EMPTY }, { text: EMPTY }, { text: EMPTY }]);
      const source = createSupplierSource({ client });

      const result = await source.search({ query: "x", region: "mx" });

      expect(result).toEqual([]);
    });

    it("con maxVariants: 0 no llama al modelo y devuelve []", async () => {
      const { client, create } = fakeClientOutcomes([{ text: RESPONSE }]);
      const source = createSupplierSource({
        client,
        searchBudget: { maxWebSearchUses: 2, maxTokens: 8000, maxVariants: 0 },
      });

      const result = await source.search({ query: "lámina", region: "mx" });

      expect(create).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("con maxVariants: 1 hace una sola llamada (comportamiento anterior)", async () => {
      const { client, create } = fakeClientOutcomes([{ text: RESPONSE }]);
      const source = createSupplierSource({
        client,
        searchBudget: { maxWebSearchUses: 2, maxTokens: 8000, maxVariants: 1 },
      });

      const result = await source.search({ query: "lámina", region: "mx" });

      expect(create).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
    });
  });

  it("el system prompt exige volcar precios y dirección a campos estructurados, no a notes", async () => {
    // Arrange
    const { client, create } = fakeClientSequence([RESPONSE]);
    const source = createSupplierSource({ client });

    // Act
    await source.search({ query: "x", region: "mx" });

    // Assert: la regla y el mini-ejemplo correcto/incorrecto están en el prompt.
    const call = create.mock.calls[0]?.[0] as { system: string };
    expect(call.system).toContain('NUNCA dejes un precio o una dirección solo en "notes"');
    expect(call.system).toContain("Incorrecto:");
    expect(call.system).toContain("Correcto:");
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

  it("sin searchBudget usa los defaults (adaptive sin effort, 5 usos, 3 variantes)", async () => {
    const { client, create } = fakeClientSequence([emptyJson]);
    const source = createSupplierSource({ client });
    await source.search({ query: "láminas", region: "mx" });
    // Default de fan-out: 3 variantes → 3 llamadas.
    expect(create).toHaveBeenCalledTimes(3);
    const args = create.mock.calls[0]?.[0] as CreateArgs;
    expect(args.thinking).toEqual({ type: "adaptive" });
    expect(args.output_config).toBeUndefined();
    expect(args.tools[0]?.max_uses).toBe(5);
  });

  it("el budget (effort/maxTokens/maxWebSearchUses) se aplica a CADA llamada del fan-out", async () => {
    const { client, create } = fakeClientSequence([emptyJson]);
    const source = createSupplierSource({
      client,
      searchBudget: { maxWebSearchUses: 2, maxTokens: 8000, effort: "low" },
    });
    await source.search({ query: "láminas", region: "mx" });
    // Sin maxVariants explícito el default sigue siendo 3.
    expect(create).toHaveBeenCalledTimes(3);
    for (const call of create.mock.calls) {
      const args = call[0] as CreateArgs;
      // El modelo (opus 4.8) NO soporta thinking "enabled": adaptive + effort.
      expect(args.thinking).toEqual({ type: "adaptive" });
      expect(args.output_config).toEqual({ effort: "low" });
      expect(args.max_tokens).toBe(8000);
      expect(args.tools[0]?.max_uses).toBe(2);
    }
  });
});

describe("buildQueryVariants", () => {
  it("genera 3 variantes fijas con la query original primero", () => {
    // Arrange
    const query = "dinamómetro Extech 475040";

    // Act
    const variants = buildQueryVariants(query);

    // Assert: plantillas fijas del spec, la original SIEMPRE primera.
    expect(variants).toEqual([
      "dinamómetro Extech 475040",
      "distribuidor mayorista de dinamómetro Extech 475040 en México",
      "proveedores de dinamómetro Extech 475040 al por mayor",
    ]);
  });
});
