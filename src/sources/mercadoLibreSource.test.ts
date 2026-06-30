// Tests del adaptador de MercadoLibre: orquestación de OAuth + búsqueda con
// `fetch` inyectado (sin red real). La capa de parseo se prueba aparte.

import { describe, it, expect, vi } from "vitest";
import { createMercadoLibreSource, type FetchFn } from "./mercadoLibreSource.js";

/** Crea una Response JSON con el status indicado. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const TOKEN_BODY = { access_token: "APP_USR-token" };
const SEARCH_BODY = {
  results: [
    {
      title: "Apple iPhone 15 128GB",
      price: 17499,
      currency_id: "MXN",
      condition: "new",
      official_store_id: 1,
      seller: { nickname: "Apple Store Oficial" },
    },
  ],
};

/** fetch falso que rutea por URL (token vs búsqueda) y registra las llamadas. */
function makeFetch(opts: {
  token?: Response;
  search?: Response;
  calls?: { url: string; init?: RequestInit }[];
}): FetchFn {
  return async (url, init) => {
    opts.calls?.push({ url, init });
    if (url.includes("/oauth/token")) {
      return opts.token ?? jsonResponse(TOKEN_BODY);
    }
    if (url.includes("/search")) {
      return opts.search ?? jsonResponse(SEARCH_BODY);
    }
    throw new Error(`URL inesperada: ${url}`);
  };
}

const PRODUCT = { query: "iPhone 15 128GB", region: "mx" };

describe("createMercadoLibreSource", () => {
  it("lanza si faltan credenciales", () => {
    expect(() => createMercadoLibreSource({ clientId: "", clientSecret: "x" })).toThrow();
    expect(() => createMercadoLibreSource({ clientId: "x", clientSecret: "  " })).toThrow();
  });

  it("expone el id de fuente estable", () => {
    const source = createMercadoLibreSource({
      clientId: "id",
      clientSecret: "secret",
      fetchFn: makeFetch({}),
    });
    expect(source.id).toBe("mercado-libre");
  });

  it("devuelve [] sin llamar a la API cuando la región no tiene site", async () => {
    // Arrange
    const fetchFn = vi.fn<FetchFn>(makeFetch({}));
    const source = createMercadoLibreSource({ clientId: "id", clientSecret: "secret", fetchFn });

    // Act
    const offers = await source.search({ query: "x", region: "global" });

    // Assert
    expect(offers).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("obtiene token y busca, mapeando los resultados a Offer", async () => {
    // Arrange
    const calls: { url: string; init?: RequestInit }[] = [];
    const source = createMercadoLibreSource({
      clientId: "id",
      clientSecret: "secret",
      fetchFn: makeFetch({ calls }),
    });

    // Act
    const offers = await source.search(PRODUCT);

    // Assert
    expect(offers).toHaveLength(1);
    expect(offers[0]?.productTitle).toBe("Apple iPhone 15 128GB");
    expect(offers[0]?.priceAmount).toBe(17499);
    // La búsqueda usa el site de la región y el Bearer token obtenido.
    const searchCall = calls.find((c) => c.url.includes("/search"));
    expect(searchCall?.url).toContain("/sites/MLM/search");
    expect(searchCall?.init?.headers).toMatchObject({
      authorization: "Bearer APP_USR-token",
    });
  });

  it("pide el token con grant_type client_credentials y las credenciales", async () => {
    // Arrange
    const calls: { url: string; init?: RequestInit }[] = [];
    const source = createMercadoLibreSource({
      clientId: "mi-id",
      clientSecret: "mi-secret",
      fetchFn: makeFetch({ calls }),
    });

    // Act
    await source.search(PRODUCT);

    // Assert
    const tokenCall = calls.find((c) => c.url.includes("/oauth/token"));
    const body = String(tokenCall?.init?.body ?? "");
    expect(body).toContain("grant_type=client_credentials");
    expect(body).toContain("mi-id");
    expect(body).toContain("mi-secret");
  });

  it("lanza cuando la obtención del token falla", async () => {
    // Arrange
    const source = createMercadoLibreSource({
      clientId: "id",
      clientSecret: "secret",
      fetchFn: makeFetch({ token: jsonResponse({ error: "invalid_client" }, 401) }),
    });

    // Act / Assert
    await expect(source.search(PRODUCT)).rejects.toThrow();
  });

  it("lanza cuando la búsqueda falla", async () => {
    // Arrange
    const source = createMercadoLibreSource({
      clientId: "id",
      clientSecret: "secret",
      fetchFn: makeFetch({ search: jsonResponse({ message: "server error" }, 500) }),
    });

    // Act / Assert
    await expect(source.search(PRODUCT)).rejects.toThrow();
  });
});
