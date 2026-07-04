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
