import { describe, it, expect } from "vitest";
import { parseSuppliers } from "./supplierSchema.js";

describe("parseSuppliers", () => {
  const ok = {
    suppliers: [
      {
        name: "Láminas Express",
        website: "https://laminasexpress.mx",
        material: "lámina galvanizada",
        wholesalePrice: 165,
        currency: "MXN",
        moq: 200,
        contact: { email: "ventas@laminasexpress.mx", whatsapp: "+52 33 1234 5678" },
        trusted: true,
      },
    ],
  };

  it("mapea proveedores válidos con la región dada", () => {
    const result = parseSuppliers(ok, "mx");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "Láminas Express",
      material: "lámina galvanizada",
      region: "mx",
      wholesalePrice: 165,
      currency: "MXN",
      trusted: true,
      contact: { email: "ventas@laminasexpress.mx", whatsapp: "+52 33 1234 5678" },
    });
  });

  it("descarta un item malformado sin perder los válidos", () => {
    const data = { suppliers: [{ material: "sin nombre" }, ok.suppliers[0]] };
    const result = parseSuppliers(data, "mx");
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("Láminas Express");
  });

  it("omite un precio de mayoreo no positivo pero conserva el proveedor", () => {
    const data = { suppliers: [{ name: "X", material: "y", contact: {}, wholesalePrice: 0 }] };
    const result = parseSuppliers(data, "mx");
    expect(result).toHaveLength(1);
    expect(result[0]?.wholesalePrice).toBeUndefined();
  });

  it("asume trusted=false cuando no viene", () => {
    const data = { suppliers: [{ name: "X", material: "y", contact: {} }] };
    const result = parseSuppliers(data, "mx");
    expect(result[0]?.trusted).toBe(false);
  });

  it("lanza cuando la forma de nivel superior es inválida", () => {
    expect(() => parseSuppliers({ foo: 1 }, "mx")).toThrow();
  });

  describe("normalización de priceUnit", () => {
    const parseUnit = (raw: string) => {
      const data = { suppliers: [{ name: "X", material: "y", contact: {}, priceUnit: raw }] };
      return parseSuppliers(data, "mx")[0]?.priceUnit;
    };

    it("normaliza variantes textuales a la unidad canónica", () => {
      // Arrange: pares [texto del modelo, unidad canónica]
      const cases: ReadonlyArray<[string, string]> = [
        ["kg", "kg"],
        ["por kilo", "kg"],
        ["pieza", "pieza"],
        ["unidad", "pieza"],
        ["c/u", "pieza"],
        ["ton", "tonelada"],
        ["tonelada", "tonelada"],
        ["m2", "m2"],
        ["metro cuadrado", "m2"],
      ];
      for (const [raw, expected] of cases) {
        expect(parseUnit(raw), `priceUnit "${raw}"`).toBe(expected);
      }
    });

    it("omite priceUnit no reconocida (sin campo)", () => {
      const data = {
        suppliers: [{ name: "X", material: "y", contact: {}, priceUnit: "docena" }],
      };
      const result = parseSuppliers(data, "mx");
      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty("priceUnit");
    });

    it("omite priceUnit ausente (sin campo)", () => {
      const data = { suppliers: [{ name: "X", material: "y", contact: {} }] };
      const result = parseSuppliers(data, "mx");
      expect(result[0]).not.toHaveProperty("priceUnit");
    });
  });
});
