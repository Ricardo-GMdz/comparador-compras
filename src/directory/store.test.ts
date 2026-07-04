import { describe, it, expect } from "vitest";
import { supplierKey, mergeSuppliers, loadDirectory, saveDirectory } from "./store.js";
import type { SupplierCandidate, Supplier } from "../domain/supplier.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const NOW = "2026-07-01T10:00:00.000Z";
const BEFORE = "2026-06-01T10:00:00.000Z";

describe("mergeSuppliers", () => {
  it("agrega un proveedor nuevo con firstSeen y lastSeen = now", () => {
    const result = mergeSuppliers([], [candidate({ website: "https://a.com" })], NOW);
    expect(result.added).toBe(1);
    expect(result.suppliers).toHaveLength(1);
    expect(result.suppliers[0]?.firstSeen).toBe(NOW);
    expect(result.suppliers[0]?.lastSeen).toBe(NOW);
  });

  it("actualiza un proveedor existente conservando firstSeen y refrescando lastSeen", () => {
    const existing: Supplier = {
      ...candidate({ website: "https://a.com", wholesalePrice: 200 }),
      firstSeen: BEFORE,
      lastSeen: BEFORE,
    };
    const result = mergeSuppliers(
      [existing],
      [candidate({ website: "https://a.com", wholesalePrice: 180 })],
      NOW,
    );
    expect(result.added).toBe(0);
    expect(result.suppliers).toHaveLength(1);
    expect(result.suppliers[0]?.wholesalePrice).toBe(180);
    expect(result.suppliers[0]?.firstSeen).toBe(BEFORE);
    expect(result.suppliers[0]?.lastSeen).toBe(NOW);
  });

  it("no muta el directorio existente", () => {
    const existing: Supplier = {
      ...candidate({ website: "https://a.com" }),
      firstSeen: BEFORE,
      lastSeen: BEFORE,
    };
    const snapshot = { ...existing };
    mergeSuppliers([existing], [candidate({ website: "https://a.com", wholesalePrice: 1 })], NOW);
    expect(existing).toEqual(snapshot);
  });
});

describe("loadDirectory / saveDirectory", () => {
  it("devuelve un directorio vacío cuando el archivo no existe", async () => {
    const path = join(tmpdir(), "no-existe-directorio.json");
    const dir = await loadDirectory(path);
    expect(dir).toEqual([]);
  });

  it("persiste y relee los proveedores (round-trip)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "dir-"));
    const path = join(tmp, "directorio.json");
    const suppliers: Supplier[] = [
      { ...candidate({ website: "https://a.com" }), firstSeen: NOW, lastSeen: NOW },
    ];
    await saveDirectory(path, suppliers);
    const reloaded = await loadDirectory(path);
    expect(reloaded).toEqual(suppliers);
    rmSync(tmp, { recursive: true, force: true });
  });
});
