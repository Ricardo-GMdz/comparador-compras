import { describe, expect, it } from "vitest";

import { buildQuoteMessage } from "./quoteTemplate.js";

describe("buildQuoteMessage", () => {
  const input = {
    supplierName: "Aceros del Norte, S.A.",
    material: "lámina galvanizada",
    quantity: "500 piezas",
    spec: "lámina galvanizada calibre 22, 1.22 x 2.44 m",
  };

  it("incluye el nombre del proveedor, la cantidad y la especificación", () => {
    // Arrange + Act
    const message = buildQuoteMessage(input);

    // Assert
    expect(message).toContain(input.supplierName);
    expect(message).toContain(input.quantity);
    expect(message).toContain(input.spec);
  });

  it("está en español y pide precio de mayoreo, mínimo de compra y tiempos de entrega", () => {
    // Act
    const message = buildQuoteMessage(input);

    // Assert: saludos y pedidos concretos en español
    expect(message).toMatch(/Hola/i);
    expect(message).toMatch(/precio de mayoreo/i);
    expect(message).toMatch(/mínimo de compra/i);
    expect(message).toMatch(/tiempos de entrega/i);
  });

  it("no contiene placeholders sin resolver ni 'undefined'", () => {
    // Act
    const message = buildQuoteMessage(input);

    // Assert
    expect(message).not.toContain("{");
    expect(message).not.toContain("undefined");
  });
});
