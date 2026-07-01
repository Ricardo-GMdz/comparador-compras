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

  it("conserva la oferta y omite la url cuando es malformada (best-effort)", () => {
    // Arrange: una url relativa/malformada no debe descartar una oferta usable.
    const raw = {
      productTitle: "Válida con url mala",
      provider: { name: "Tienda", trusted: true },
      priceAmount: 50,
      currency: "USD",
      url: "/ruta-relativa",
    };

    // Act
    const offer = toOffer(raw, "us");

    // Assert: la oferta sobrevive con sus campos esenciales, sin url.
    expect(offer).toBeDefined();
    expect(offer?.productTitle).toBe("Válida con url mala");
    expect(offer?.url).toBeUndefined();
  });

  it("conserva la url cuando es válida y absoluta", () => {
    // Arrange
    const raw = {
      productTitle: "Con url válida",
      provider: { name: "Tienda", trusted: true },
      priceAmount: 50,
      currency: "USD",
      url: "https://tienda.com/p",
    };

    // Act
    const offer = toOffer(raw, "us");

    // Assert
    expect(offer?.url).toBe("https://tienda.com/p");
  });
});

describe("toOffer — variant", () => {
  it("mapea variant cuando el modelo la provee con tierRank entero y label", () => {
    // Arrange
    const raw = {
      productTitle: "iPhone 256GB",
      provider: { name: "Tienda", trusted: true },
      priceAmount: 140,
      currency: "USD",
      variant: { tierRank: 1, label: "256GB" },
    };

    // Act
    const offer = toOffer(raw, "us");

    // Assert
    expect(offer?.variant).toEqual({ tierRank: 1, label: "256GB" });
  });

  it("redondea un tierRank no entero al entero más cercano", () => {
    // Arrange
    const raw = {
      productTitle: "x",
      provider: { name: "T" },
      priceAmount: 10,
      currency: "USD",
      variant: { tierRank: 1.6 },
    };

    // Act
    const offer = toOffer(raw, "us");

    // Assert
    expect(offer?.variant?.tierRank).toBe(2);
  });

  it("acepta tierRank provisto como string numérico", () => {
    // Arrange
    const raw = {
      productTitle: "x",
      provider: { name: "T" },
      priceAmount: 10,
      currency: "USD",
      variant: { tierRank: "2" },
    };

    // Act
    const offer = toOffer(raw, "us");

    // Assert
    expect(offer?.variant?.tierRank).toBe(2);
  });

  it("omite variant cuando el modelo no la provee", () => {
    // Arrange
    const raw = {
      productTitle: "x",
      provider: { name: "T" },
      priceAmount: 10,
      currency: "USD",
    };

    // Act
    const offer = toOffer(raw, "us");

    // Assert
    expect(offer?.variant).toBeUndefined();
  });

  it("omite variant cuando tierRank no es interpretable", () => {
    // Arrange
    const raw = {
      productTitle: "x",
      provider: { name: "T" },
      priceAmount: 10,
      currency: "USD",
      variant: { tierRank: "no-es-numero", label: "Pro" },
    };

    // Act
    const offer = toOffer(raw, "us");

    // Assert
    expect(offer?.variant).toBeUndefined();
  });

  it.each([["  "], [""], ["0x10"], ["1e2"], ["   \t"]])(
    "omite variant cuando tierRank string es basura/formato raro (%j)",
    (tierRank) => {
      // Arrange: un string vacío/espacios o notación hex/exp no es un ranking
      // limpio; no debe coaccionarse a 0 ni a un entero inventado.
      const raw = {
        productTitle: "x",
        provider: { name: "T" },
        priceAmount: 10,
        currency: "USD",
        variant: { tierRank, label: "Pro" },
      };

      // Act
      const offer = toOffer(raw, "us");

      // Assert
      expect(offer?.variant).toBeUndefined();
    },
  );

  it("omite el label vacío pero conserva el tierRank", () => {
    // Arrange
    const raw = {
      productTitle: "x",
      provider: { name: "T" },
      priceAmount: 10,
      currency: "USD",
      variant: { tierRank: 1, label: "   " },
    };

    // Act
    const offer = toOffer(raw, "us");

    // Assert
    expect(offer?.variant).toEqual({ tierRank: 1 });
  });
});

describe("toOffer — condition", () => {
  it.each([
    ["new", "new"],
    ["nuevo", "new"],
    ["refurbished", "refurbished"],
    ["reacondicionado", "refurbished"],
    ["used", "used"],
    ["usado", "used"],
    ["  New  ", "new"],
  ])("normaliza la condición '%s' a '%s'", (condition, expected) => {
    // Arrange
    const raw = {
      productTitle: "x",
      provider: { name: "T" },
      priceAmount: 10,
      currency: "USD",
      condition,
    };

    // Act
    const offer = toOffer(raw, "us");

    // Assert
    expect(offer?.condition).toBe(expected);
  });

  it("omite la condición cuando el modelo no la provee", () => {
    // Arrange
    const raw = { productTitle: "x", provider: { name: "T" }, priceAmount: 10, currency: "USD" };

    // Act
    const offer = toOffer(raw, "us");

    // Assert
    expect(offer?.condition).toBeUndefined();
  });

  it("omite la condición cuando no es reconocible (equivale a desconocida)", () => {
    // Arrange
    const raw = {
      productTitle: "x",
      provider: { name: "T" },
      priceAmount: 10,
      currency: "USD",
      condition: "abierto-en-caja",
    };

    // Act
    const offer = toOffer(raw, "us");

    // Assert
    expect(offer?.condition).toBeUndefined();
  });
});
