// Tests del parseo y validación de ofertas crudas del modelo (AAA).

import { describe, it, expect } from "vitest";
import { rawOffersSchema, toOffer } from "./offerSchema.js";

describe("rawOffersSchema", () => {
  it("acepta un arreglo de ofertas con la forma esperada", () => {
    // Arrange
    const input = [
      {
        productTitle: "Teclado mecánico",
        provider: { name: "TiendaX", url: "https://tiendax.com", trusted: true },
        priceAmount: 120.5,
        currency: "USD",
        url: "https://tiendax.com/teclado",
      },
    ];

    // Act
    const result = rawOffersSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  it("rechaza ofertas sin título de producto", () => {
    // Arrange
    const input = [
      {
        productTitle: "",
        provider: { name: "TiendaX" },
        priceAmount: 10,
        currency: "USD",
      },
    ];

    // Act
    const result = rawOffersSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it("rechaza una URL de proveedor inválida", () => {
    // Arrange
    const input = [
      {
        productTitle: "Mouse",
        provider: { name: "TiendaY", url: "no-es-una-url" },
        priceAmount: 10,
        currency: "USD",
      },
    ];

    // Act
    const result = rawOffersSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("toOffer", () => {
  it("mapea una oferta cruda válida a Offer con la región dada", () => {
    // Arrange
    const raw = {
      productTitle: "Auriculares",
      provider: { name: "AudioShop", trusted: true },
      priceAmount: 99.99,
      currency: "eur",
      url: "https://audioshop.com/x",
    };

    // Act
    const offer = toOffer(raw, "eu");

    // Assert
    expect(offer).toEqual({
      productTitle: "Auriculares",
      provider: { name: "AudioShop", trusted: true },
      priceAmount: 99.99,
      currency: "EUR",
      region: "eu",
      url: "https://audioshop.com/x",
      raw: JSON.stringify(raw),
    });
  });

  it("asume trusted=false cuando el proveedor no lo indica", () => {
    // Arrange
    const raw = {
      productTitle: "Cable",
      provider: { name: "Desconocida" },
      priceAmount: 5,
      currency: "USD",
    };

    // Act
    const offer = toOffer(raw, "us");

    // Assert
    expect(offer?.provider.trusted).toBe(false);
  });

  it("normaliza un precio string con separadores de miles y decimales", () => {
    // Arrange
    const raw = {
      productTitle: "Notebook",
      provider: { name: "CompuMundo" },
      priceAmount: "$1.299,00",
      currency: "ARS",
    };

    // Act
    const offer = toOffer(raw, "ar");

    // Assert
    expect(offer?.priceAmount).toBe(1299);
  });

  it("interpreta una coma como separador decimal cuando es el único separador", () => {
    // Arrange
    const raw = {
      productTitle: "Funda",
      provider: { name: "AccesoriosYa" },
      priceAmount: "19,90",
      currency: "EUR",
    };

    // Act
    const offer = toOffer(raw, "eu");

    // Assert
    expect(offer?.priceAmount).toBe(19.9);
  });

  it("devuelve undefined cuando el precio no es interpretable", () => {
    // Arrange
    const raw = {
      productTitle: "Misterio",
      provider: { name: "TiendaZ" },
      priceAmount: "consultar",
      currency: "USD",
    };

    // Act
    const offer = toOffer(raw, "us");

    // Assert
    expect(offer).toBeUndefined();
  });

  // Casos de formato US (coma de miles, sin centavos) y punto de miles solitario.
  it.each([
    ["$1,299", 1299],
    ["$2,500", 2500],
    ["$1.299", 1299],
    ["1,000", 1000],
    ["1.000", 1000],
    ["1,234,567", 1234567],
    ["12,99", 12.99],
    ["19.90", 19.9],
  ])("interpreta correctamente el precio string %s como %d", (priceAmount, expected) => {
    // Arrange
    const raw = {
      productTitle: "Producto",
      provider: { name: "Tienda" },
      priceAmount,
      currency: "USD",
    };

    // Act
    const offer = toOffer(raw, "us");

    // Assert
    expect(offer?.priceAmount).toBe(expected);
  });

  it("descarta una oferta con priceAmount negativo (string)", () => {
    // Arrange
    const raw = {
      productTitle: "Precio falso",
      provider: { name: "Tienda" },
      priceAmount: "-5",
      currency: "USD",
    };

    // Act
    const offer = toOffer(raw, "us");

    // Assert
    expect(offer).toBeUndefined();
  });

  it("descarta una oferta con priceAmount negativo (number)", () => {
    // Arrange
    const raw = {
      productTitle: "Precio falso",
      provider: { name: "Tienda" },
      priceAmount: -5,
      currency: "USD",
    };

    // Act
    const offer = toOffer(raw, "us");

    // Assert
    expect(offer).toBeUndefined();
  });

  it("descarta una oferta con priceAmount 0", () => {
    // Arrange
    const raw = {
      productTitle: "Gratis falso",
      provider: { name: "Tienda" },
      priceAmount: 0,
      currency: "USD",
    };

    // Act
    const offer = toOffer(raw, "us");

    // Assert
    expect(offer).toBeUndefined();
  });
});
