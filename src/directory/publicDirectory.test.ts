// Tests del directorio público: qué proveedores se publican en la landing y
// con qué campos (los datos privados como notas y timestamps quedan fuera).

import { describe, it, expect } from "vitest";
import type { Supplier } from "../domain/supplier.js";
import { buildPublicDirectory } from "./publicDirectory.js";

const NOW = "2026-07-05T00:00:00.000Z";

function sup(overrides: Partial<Supplier> = {}): Supplier {
  return {
    name: "Proveedor X",
    material: "lámina",
    region: "mx",
    contact: {},
    trusted: true,
    status: "pendiente",
    firstSeen: NOW,
    lastSeen: NOW,
    ...overrides,
  };
}

describe("buildPublicDirectory", () => {
  it("publica solo los proveedores contactados o que cotizaron", () => {
    // Arrange
    const suppliers = [
      sup({ name: "pendiente", status: "pendiente" }),
      sup({ name: "contactado", status: "contactado" }),
      sup({ name: "cotizo", status: "cotizó" }),
      sup({ name: "descartado", status: "descartado" }),
    ];

    // Act
    const result = buildPublicDirectory(suppliers);

    // Assert
    expect(result.map((s) => s.name)).toEqual(["contactado", "cotizo"]);
  });

  it("incluye los campos públicos (contacto, precio, unidad, web, estado)", () => {
    // Arrange
    const suppliers = [
      sup({
        name: "PYLSA",
        status: "cotizó",
        website: "https://pylsa.com",
        wholesalePrice: 585,
        currency: "MXN",
        priceUnit: "pieza",
        moq: 100,
        contact: { email: "ventas@pylsa.com", whatsapp: "+52 229 158 9470" },
      }),
    ];

    // Act
    const result = buildPublicDirectory(suppliers);

    // Assert
    expect(result[0]).toEqual({
      name: "PYLSA",
      material: "lámina",
      region: "mx",
      website: "https://pylsa.com",
      wholesalePrice: 585,
      currency: "MXN",
      priceUnit: "pieza",
      moq: 100,
      contact: { email: "ventas@pylsa.com", whatsapp: "+52 229 158 9470" },
      trusted: true,
      status: "cotizó",
    });
  });

  it("NO publica notas ni timestamps (datos privados)", () => {
    // Arrange
    const suppliers = [sup({ status: "contactado", notes: "margen negociado 12%" })];

    // Act
    const result = buildPublicDirectory(suppliers) as unknown as readonly Record<string, unknown>[];

    // Assert
    expect(result[0]).not.toHaveProperty("notes");
    expect(result[0]).not.toHaveProperty("firstSeen");
    expect(result[0]).not.toHaveProperty("lastSeen");
  });

  it("publica catalogPrice y address, pero NO favorite", () => {
    const out = buildPublicDirectory([
      {
        name: "Master Supply",
        material: "Extech 475040",
        region: "mx",
        trusted: true,
        contact: {},
        status: "contactado",
        catalogPrice: 439.99,
        address: "Monterrey, NL",
        favorite: true,
        firstSeen: NOW,
        lastSeen: NOW,
      },
    ]);
    expect(out[0]?.catalogPrice).toBe(439.99);
    expect(out[0]?.address).toBe("Monterrey, NL");
    expect(out[0]).not.toHaveProperty("favorite");
  });

  it("no muta la entrada y devuelve [] sin publicables", () => {
    // Arrange
    const suppliers = [sup({ status: "pendiente" })];
    const snapshot = JSON.stringify(suppliers);

    // Act
    const result = buildPublicDirectory(suppliers);

    // Assert
    expect(result).toEqual([]);
    expect(JSON.stringify(suppliers)).toBe(snapshot);
  });
});
