import { describe, it, expect } from "vitest";
import {
  supplierKey,
  mergeSuppliers,
  updateSupplier,
  removeSupplier,
  loadDirectory,
  saveDirectory,
} from "./store.js";
import type { SupplierCandidate, Supplier } from "../domain/supplier.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
      status: "pendiente",
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

  it("agrega los candidatos nuevos con status 'pendiente'", () => {
    const result = mergeSuppliers([], [candidate({ website: "https://a.com" })], NOW);
    expect(result.suppliers[0]?.status).toBe("pendiente");
  });

  it("conserva status y notes del existente al actualizar (el sourcing no los pisa)", () => {
    const existing: Supplier = {
      ...candidate({ website: "https://a.com", notes: "ya les escribí" }),
      status: "contactado",
      firstSeen: BEFORE,
      lastSeen: BEFORE,
    };
    const result = mergeSuppliers(
      [existing],
      [candidate({ website: "https://a.com", wholesalePrice: 180, notes: "nota del sourcing" })],
      NOW,
    );
    expect(result.suppliers[0]?.status).toBe("contactado");
    expect(result.suppliers[0]?.notes).toBe("ya les escribí");
    expect(result.suppliers[0]?.wholesalePrice).toBe(180);
  });

  it("no muta el directorio existente", () => {
    const existing: Supplier = {
      ...candidate({ website: "https://a.com" }),
      status: "pendiente",
      firstSeen: BEFORE,
      lastSeen: BEFORE,
    };
    const snapshot = { ...existing };
    mergeSuppliers([existing], [candidate({ website: "https://a.com", wholesalePrice: 1 })], NOW);
    expect(existing).toEqual(snapshot);
  });
});

describe("updateSupplier", () => {
  function existingSupplier(overrides: Partial<Supplier> = {}): Supplier {
    return {
      ...candidate({ website: "https://a.com", wholesalePrice: 200 }),
      status: "pendiente",
      firstSeen: BEFORE,
      lastSeen: BEFORE,
      ...overrides,
    };
  }

  it("actualiza status y notes por key, refresca lastSeen y conserva el resto", () => {
    const supplier = existingSupplier();
    const key = supplierKey(supplier);
    const result = updateSupplier(
      [supplier],
      key,
      { status: "contactado", notes: "les escribí" },
      NOW,
    );
    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
    expect(result?.[0]?.status).toBe("contactado");
    expect(result?.[0]?.notes).toBe("les escribí");
    expect(result?.[0]?.lastSeen).toBe(NOW);
    // El resto de los campos quedan intactos.
    expect(result?.[0]?.name).toBe(supplier.name);
    expect(result?.[0]?.wholesalePrice).toBe(200);
    expect(result?.[0]?.firstSeen).toBe(BEFORE);
  });

  it("aplica un patch parcial sin tocar los campos no incluidos", () => {
    const supplier = existingSupplier({ notes: "nota previa" });
    const result = updateSupplier([supplier], supplierKey(supplier), { status: "cotizó" }, NOW);
    expect(result?.[0]?.status).toBe("cotizó");
    expect(result?.[0]?.notes).toBe("nota previa");
  });

  it("devuelve undefined cuando la key no existe", () => {
    const supplier = existingSupplier();
    const result = updateSupplier([supplier], "d:no-existe.com", { status: "contactado" }, NOW);
    expect(result).toBeUndefined();
  });

  it("mergea contact del patch sin pisar los campos existentes", () => {
    // Arrange: el proveedor ya tiene email; el patch trae email nuevo y phone.
    const supplier = existingSupplier({ contact: { email: "ventas@a.com" } });

    // Act
    const result = updateSupplier(
      [supplier],
      supplierKey(supplier),
      { contact: { email: "otro@a.com", phone: "+52 55 1234" } },
      NOW,
    );

    // Assert: el email existente gana; el phone faltante se agrega.
    expect(result?.[0]?.contact).toEqual({ email: "ventas@a.com", phone: "+52 55 1234" });
  });

  it("un patch sin contact deja el contact intacto", () => {
    const supplier = existingSupplier({ contact: { email: "ventas@a.com" } });
    const result = updateSupplier([supplier], supplierKey(supplier), { status: "cotizó" }, NOW);
    expect(result?.[0]?.contact).toEqual({ email: "ventas@a.com" });
  });

  it("no muta el directorio de entrada", () => {
    const supplier = existingSupplier();
    const suppliers = [supplier];
    const snapshot = { ...supplier };
    updateSupplier(suppliers, supplierKey(supplier), { status: "descartado" }, NOW);
    expect(supplier).toEqual(snapshot);
    expect(suppliers).toHaveLength(1);
  });
});

describe("removeSupplier", () => {
  it("saca el proveedor correcto y deja los demás", () => {
    const a: Supplier = {
      ...candidate({ website: "https://a.com" }),
      status: "pendiente",
      firstSeen: BEFORE,
      lastSeen: BEFORE,
    };
    const b: Supplier = {
      ...candidate({ website: "https://b.com" }),
      status: "pendiente",
      firstSeen: BEFORE,
      lastSeen: BEFORE,
    };
    const result = removeSupplier([a, b], supplierKey(a));
    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
    expect(result?.[0]?.website).toBe("https://b.com");
  });

  it("devuelve undefined cuando la key no existe", () => {
    const a: Supplier = {
      ...candidate({ website: "https://a.com" }),
      status: "pendiente",
      firstSeen: BEFORE,
      lastSeen: BEFORE,
    };
    expect(removeSupplier([a], "d:no-existe.com")).toBeUndefined();
  });

  it("no muta el directorio de entrada", () => {
    const a: Supplier = {
      ...candidate({ website: "https://a.com" }),
      status: "pendiente",
      firstSeen: BEFORE,
      lastSeen: BEFORE,
    };
    const suppliers = [a];
    removeSupplier(suppliers, supplierKey(a));
    expect(suppliers).toHaveLength(1);
    expect(suppliers[0]).toEqual(a);
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
      {
        ...candidate({ website: "https://a.com" }),
        status: "pendiente",
        firstSeen: NOW,
        lastSeen: NOW,
      },
    ];
    await saveDirectory(path, suppliers);
    const reloaded = await loadDirectory(path);
    expect(reloaded).toEqual(suppliers);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("migra un proveedor persistido sin status a 'pendiente'", async () => {
    // Directorio viejo (pre-v2.1): el JSON en disco no trae `status`.
    const tmp = mkdtempSync(join(tmpdir(), "dir-"));
    const path = join(tmp, "directorio.json");
    const legacy = [{ ...candidate({ website: "https://a.com" }), firstSeen: NOW, lastSeen: NOW }];
    writeFileSync(path, JSON.stringify(legacy), "utf8");
    const reloaded = await loadDirectory(path);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]?.status).toBe("pendiente");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("hace round-trip con status y priceUnit presentes", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "dir-"));
    const path = join(tmp, "directorio.json");
    const suppliers: Supplier[] = [
      {
        ...candidate({ website: "https://a.com", priceUnit: "kg" }),
        status: "contactado",
        firstSeen: NOW,
        lastSeen: NOW,
      },
    ];
    await saveDirectory(path, suppliers);
    const reloaded = await loadDirectory(path);
    expect(reloaded).toEqual(suppliers);
    rmSync(tmp, { recursive: true, force: true });
  });
});
