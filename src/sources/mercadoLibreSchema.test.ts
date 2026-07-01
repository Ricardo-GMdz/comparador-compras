// Tests de la capa pura del adaptador de MercadoLibre: mapeo de región a site
// ID y parseo/validación defensiva de las respuestas de la API (AAA).

import { describe, it, expect } from "vitest";
import {
  parseMlAccessToken,
  parseMlSearchResponse,
  siteIdForRegion,
} from "./mercadoLibreSchema.js";

describe("siteIdForRegion", () => {
  it("mapea regiones conocidas a su site ID de MercadoLibre", () => {
    expect(siteIdForRegion("mx")).toBe("MLM");
    expect(siteIdForRegion("ar")).toBe("MLA");
    expect(siteIdForRegion("br")).toBe("MLB");
  });

  it("es insensible a mayúsculas y espacios", () => {
    expect(siteIdForRegion("  MX ")).toBe("MLM");
  });

  it("devuelve undefined para una región sin site (ej. global)", () => {
    expect(siteIdForRegion("global")).toBeUndefined();
    expect(siteIdForRegion("xx")).toBeUndefined();
  });
});

describe("parseMlAccessToken", () => {
  it("extrae el access_token de una respuesta válida", () => {
    expect(parseMlAccessToken({ access_token: "APP_USR-123" })).toBe("APP_USR-123");
  });

  it("lanza cuando falta el access_token", () => {
    expect(() => parseMlAccessToken({})).toThrow();
  });
});

describe("parseMlSearchResponse", () => {
  const validResponse = {
    results: [
      {
        title: "Apple iPhone 15 128GB",
        price: 17499,
        currency_id: "MXN",
        permalink: "https://articulo.mercadolibre.com.mx/MLM-1",
        condition: "new",
        official_store_id: 123,
        seller: { nickname: "Apple Store Oficial" },
      },
      {
        title: "iPhone 15 usado",
        price: 9000,
        currency_id: "MXN",
        condition: "used",
        official_store_id: null,
        seller: { nickname: "juanperez" },
      },
    ],
  };

  it("mapea los resultados a Offer con la región dada", () => {
    // Act
    const offers = parseMlSearchResponse(validResponse, "mx");

    // Assert
    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({
      productTitle: "Apple iPhone 15 128GB",
      priceAmount: 17499,
      currency: "MXN",
      region: "mx",
      url: "https://articulo.mercadolibre.com.mx/MLM-1",
      condition: "new",
    });
  });

  it("marca trusted=true cuando la oferta es de una tienda oficial", () => {
    // Act
    const offers = parseMlSearchResponse(validResponse, "mx");

    // Assert
    expect(offers[0]?.provider.trusted).toBe(true);
    expect(offers[1]?.provider.trusted).toBe(false);
  });

  it("usa el nickname del vendedor como nombre del proveedor", () => {
    // Act
    const offers = parseMlSearchResponse(validResponse, "mx");

    // Assert
    expect(offers[0]?.provider.name).toBe("Apple Store Oficial");
  });

  it("mapea la condición new/used y omite las desconocidas", () => {
    // Arrange
    const data = {
      results: [{ title: "a", price: 10, currency_id: "MXN", condition: "not_specified" }],
    };

    // Act
    const offers = parseMlSearchResponse(data, "mx");

    // Assert
    expect(offers[0]?.condition).toBeUndefined();
  });

  it("descarta items con precio no positivo, sin romper el resto", () => {
    // Arrange
    const data = {
      results: [
        { title: "gratis falso", price: 0, currency_id: "MXN" },
        { title: "válida", price: 100, currency_id: "MXN" },
      ],
    };

    // Act
    const offers = parseMlSearchResponse(data, "mx");

    // Assert
    expect(offers).toHaveLength(1);
    expect(offers[0]?.productTitle).toBe("válida");
  });

  it("conserva el item y omite la url cuando el permalink es malformado/relativo", () => {
    // Arrange: un permalink relativo no debe descartar un item por lo demás válido.
    const data = {
      results: [
        {
          title: "iPhone con permalink malo",
          price: 100,
          currency_id: "MXN",
          permalink: "/MLM-123",
          condition: "new",
        },
      ],
    };

    // Act
    const offers = parseMlSearchResponse(data, "mx");

    // Assert: el item sobrevive con sus campos esenciales, sin url.
    expect(offers).toHaveLength(1);
    expect(offers[0]?.productTitle).toBe("iPhone con permalink malo");
    expect(offers[0]?.url).toBeUndefined();
    expect(offers[0]?.priceAmount).toBe(100);
  });

  it("lanza cuando la respuesta no tiene la forma esperada", () => {
    expect(() => parseMlSearchResponse({ foo: "bar" }, "mx")).toThrow();
  });
});
