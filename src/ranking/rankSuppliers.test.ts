import { describe, it, expect } from "vitest";
import { rankSuppliers, selectBestSupplier } from "./rankSuppliers.js";
import type { Supplier } from "../domain/supplier.js";

const NOW = "2026-07-01T00:00:00.000Z";
function sup(o: Partial<Supplier>): Supplier {
  return {
    name: "S",
    material: "lámina",
    region: "mx",
    contact: {},
    trusted: true,
    status: "pendiente",
    firstSeen: NOW,
    lastSeen: NOW,
    ...o,
  };
}

describe("selectBestSupplier", () => {
  it("elige confiable + en región + más barato", () => {
    const list = [
      sup({ name: "caro-region", region: "mx", wholesalePrice: 200, trusted: true }),
      sup({ name: "barato-region", region: "mx", wholesalePrice: 150, trusted: true }),
      sup({ name: "barato-otro", region: "ar", wholesalePrice: 100, trusted: true }),
    ];
    expect(selectBestSupplier(list, "mx")?.name).toBe("barato-region");
  });

  it("cae a confiable de otra región si no hay en la región", () => {
    const list = [
      sup({ name: "otro", region: "ar", wholesalePrice: 100, trusted: true }),
      sup({ name: "no-conf", region: "mx", wholesalePrice: 90, trusted: false }),
    ];
    expect(selectBestSupplier(list, "mx")?.name).toBe("otro");
  });

  it("descarta un precio outlier (sospechosamente bajo) del best", () => {
    const list = [
      sup({ name: "error", region: "mx", wholesalePrice: 5, trusted: true }),
      sup({ name: "a", region: "mx", wholesalePrice: 150, trusted: true }),
      sup({ name: "b", region: "mx", wholesalePrice: 160, trusted: true }),
      sup({ name: "c", region: "mx", wholesalePrice: 170, trusted: true }),
    ];
    expect(selectBestSupplier(list, "mx")?.name).toBe("a");
  });
});

describe("selectBestSupplier — unidad dominante", () => {
  it("con mayoría 'pieza', un 'kg' más barato no compite por precio", () => {
    const list = [
      sup({ name: "kg-barato", wholesalePrice: 10, priceUnit: "kg" }),
      sup({ name: "pieza-barata", wholesalePrice: 150, priceUnit: "pieza" }),
      sup({ name: "pieza-cara", wholesalePrice: 200, priceUnit: "pieza" }),
    ];
    expect(selectBestSupplier(list, "mx")?.name).toBe("pieza-barata");
  });

  it("unidad no dominante puede ser elegida si no hay alternativa con precio comparable en su nivel", () => {
    const list = [
      sup({
        name: "conf-region-kg",
        region: "mx",
        trusted: true,
        wholesalePrice: 500,
        priceUnit: "kg",
      }),
      sup({
        name: "otro-pieza-1",
        region: "ar",
        trusted: false,
        wholesalePrice: 90,
        priceUnit: "pieza",
      }),
      sup({
        name: "otro-pieza-2",
        region: "ar",
        trusted: false,
        wholesalePrice: 100,
        priceUnit: "pieza",
      }),
    ];
    // La unidad dominante es "pieza", pero el único confiable+región gana por nivel.
    expect(selectBestSupplier(list, "mx")?.name).toBe("conf-region-kg");
  });

  it("comportamiento previo intacto cuando todos comparten unidad", () => {
    const list = [
      sup({ name: "caro", wholesalePrice: 200, priceUnit: "kg" }),
      sup({ name: "barato", wholesalePrice: 150, priceUnit: "kg" }),
    ];
    expect(selectBestSupplier(list, "mx")?.name).toBe("barato");
  });
});

describe("rankSuppliers — unidad dominante", () => {
  it("ordena por precio solo dentro de la unidad dominante; el resto va al final", () => {
    const list = [
      sup({ name: "kg-barato", wholesalePrice: 10, priceUnit: "kg" }),
      sup({ name: "pieza-cara", wholesalePrice: 200, priceUnit: "pieza" }),
      sup({ name: "pieza-barata", wholesalePrice: 150, priceUnit: "pieza" }),
    ];
    expect(rankSuppliers(list, "mx").map((s) => s.name)).toEqual([
      "pieza-barata",
      "pieza-cara",
      "kg-barato",
    ]);
  });

  it("sin unidades declaradas, todos los precios compiten (comportamiento previo)", () => {
    const list = [
      sup({ name: "caro", wholesalePrice: 200 }),
      sup({ name: "barato", wholesalePrice: 150 }),
    ];
    expect(rankSuppliers(list, "mx").map((s) => s.name)).toEqual(["barato", "caro"]);
  });
});

describe("rankSuppliers", () => {
  it("ordena confiables+region primero, luego por precio ascendente", () => {
    const list = [
      sup({ name: "z", region: "ar", wholesalePrice: 100, trusted: true }),
      sup({ name: "y", region: "mx", wholesalePrice: 200, trusted: true }),
      sup({ name: "x", region: "mx", wholesalePrice: 150, trusted: true }),
    ];
    expect(rankSuppliers(list, "mx").map((s) => s.name)).toEqual(["x", "y", "z"]);
  });
});
