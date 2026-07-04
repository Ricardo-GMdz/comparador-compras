import { describe, it, expect } from "vitest";
import { supplierKey } from "./store.js";
import type { SupplierCandidate } from "../domain/supplier.js";

function candidate(overrides: Partial<SupplierCandidate> = {}): SupplierCandidate {
  return {
    name: "Aceros del Norte",
    material: "lámina",
    region: "mx",
    contact: {},
    trusted: true,
    ...overrides,
  };
}

describe("supplierKey", () => {
  it("usa el dominio del sitio, ignorando protocolo/subdominio-www y path", () => {
    const a = supplierKey(candidate({ website: "https://www.aceros.com/productos" }));
    const b = supplierKey(candidate({ website: "http://aceros.com/otra" }));
    expect(a).toBe(b);
  });

  it("cae a nombre+region normalizados cuando no hay sitio", () => {
    const a = supplierKey(candidate({ name: "  Aceros del Norte ", region: "MX" }));
    const b = supplierKey(candidate({ name: "aceros del norte", region: "mx" }));
    expect(a).toBe(b);
  });

  it("distingue proveedores sin sitio de distinta región", () => {
    const a = supplierKey(candidate({ region: "mx" }));
    const b = supplierKey(candidate({ region: "ar" }));
    expect(a).not.toBe(b);
  });
});
