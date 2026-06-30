// Fuente de productos basada en la API de MercadoLibre. Autentica por OAuth
// (client-credentials), busca en el site de la región y mapea los resultados a
// `Offer`. El `fetch` es inyectable para poder testear sin red.

import type { Product, Offer } from "../domain/types.js";
import type { ProductSource } from "../domain/source.js";
import { logger } from "../logging/logger.js";
import {
  parseMlAccessToken,
  parseMlSearchResponse,
  siteIdForRegion,
} from "./mercadoLibreSchema.js";

// Identificador estable de esta fuente (parte del contrato público).
export const MERCADO_LIBRE_SOURCE_ID = "mercado-libre";

// Endpoints y límites de la API. Sin números/strings mágicos sueltos.
const OAUTH_URL = "https://api.mercadolibre.com/oauth/token";
const API_BASE = "https://api.mercadolibre.com";
const SEARCH_LIMIT = 10;

/** Función tipo `fetch` inyectable, para aislar la red en los tests. */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Dependencias del adaptador: credenciales OAuth y `fetch` opcional. */
export interface MercadoLibreSourceDeps {
  clientId: string;
  clientSecret: string;
  fetchFn?: FetchFn;
}

/**
 * Crea una `ProductSource` que consulta la API de MercadoLibre. Requiere
 * credenciales de una app de ML (client-credentials). Para regiones sin site
 * mapeado, la fuente se omite devolviendo una lista vacía.
 */
export function createMercadoLibreSource(deps: MercadoLibreSourceDeps): ProductSource {
  if (deps.clientId.trim().length === 0 || deps.clientSecret.trim().length === 0) {
    throw new Error("createMercadoLibreSource: clientId y clientSecret no pueden estar vacíos.");
  }

  const fetchFn: FetchFn = deps.fetchFn ?? ((input, init) => fetch(input, init));

  // Obtiene un access token por client-credentials. Lanza si la respuesta no
  // es OK o no trae el token (error explícito; el runner aísla la falla).
  async function getAccessToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: deps.clientId,
      client_secret: deps.clientSecret,
    }).toString();

    const response = await fetchFn(OAUTH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`mercado-libre: fallo al obtener el token (HTTP ${response.status}).`);
    }

    return parseMlAccessToken(await response.json());
  }

  async function search(product: Product): Promise<readonly Offer[]> {
    const siteId = siteIdForRegion(product.region);
    if (siteId === undefined) {
      logger.warn("mercado-libre: región sin site de MercadoLibre; se omite la fuente", {
        region: product.region,
      });
      return [];
    }

    const token = await getAccessToken();

    const query = encodeURIComponent(product.query);
    const url = `${API_BASE}/sites/${siteId}/search?q=${query}&limit=${SEARCH_LIMIT}`;
    const response = await fetchFn(url, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`mercado-libre: fallo en la búsqueda (HTTP ${response.status}).`);
    }

    return parseMlSearchResponse(await response.json(), product.region);
  }

  return { id: MERCADO_LIBRE_SOURCE_ID, search };
}
