// Capa pura del adaptador de MercadoLibre: mapeo de región a site ID y parseo
// defensivo de las respuestas de la API. Nunca confiamos en la forma de la
// respuesta externa: validamos con zod en el límite y mapeamos a `Offer`.

import { z } from "zod";
import type { Offer, OfferCondition, Provider } from "../domain/types.js";

// Mapa de región (código del CLI) a site ID de MercadoLibre por país.
const SITE_BY_REGION: Readonly<Record<string, string>> = {
  mx: "MLM",
  ar: "MLA",
  br: "MLB",
  cl: "MLC",
  co: "MCO",
  uy: "MLU",
  pe: "MPE",
  ec: "MEC",
  ve: "MLV",
  pa: "MPA",
  bo: "MBO",
  py: "MPY",
  do: "MRD",
  cr: "MCR",
  gt: "MGT",
};

/** Nombre de proveedor por defecto cuando el item no trae nickname de vendedor. */
const DEFAULT_PROVIDER_NAME = "MercadoLibre";

/**
 * Devuelve el site ID de MercadoLibre para una región, o `undefined` si la
 * región no tiene un sitio mapeado (ej. "global"): en ese caso no se puede
 * consultar ML para esa región.
 */
export function siteIdForRegion(region: string): string | undefined {
  return SITE_BY_REGION[region.trim().toLowerCase()];
}

// Respuesta del endpoint de token (client-credentials).
const tokenSchema = z.object({ access_token: z.string().min(1) });

/** Valida la respuesta de OAuth y devuelve el access_token. Lanza si falta. */
export function parseMlAccessToken(data: unknown): string {
  return tokenSchema.parse(data).access_token;
}

// Item crudo de la búsqueda de ML. Solo declaramos lo que usamos; el resto se
// ignora. `official_store_id` presente indica tienda oficial (confiable).
const mlItemSchema = z.object({
  title: z.string().min(1),
  price: z.number(),
  currency_id: z.string().min(1),
  permalink: z.string().url().optional(),
  condition: z.string().optional(),
  official_store_id: z.number().nullable().optional(),
  seller: z.object({ nickname: z.string().optional() }).optional(),
});

// La respuesta de búsqueda debe traer `results` como arreglo; cada item se
// valida por separado para no perder los buenos por uno malformado.
const mlSearchSchema = z.object({ results: z.array(z.unknown()) });

type MlItem = z.infer<typeof mlItemSchema>;

/** Mapea la condición de ML ("new"/"used") a `OfferCondition`; otras → undefined. */
function toCondition(raw: string | undefined): OfferCondition | undefined {
  if (raw === "new") {
    return "new";
  }
  if (raw === "used") {
    return "used";
  }
  return undefined;
}

/** Construye el proveedor a partir del item: tienda oficial => confiable. */
function toProvider(item: MlItem): Provider {
  const trusted = item.official_store_id !== null && item.official_store_id !== undefined;
  return {
    name: item.seller?.nickname ?? DEFAULT_PROVIDER_NAME,
    trusted,
  };
}

/** Mapea un item validado a `Offer`; descarta los de precio no positivo. */
function toOffer(item: MlItem, region: string): Offer | undefined {
  if (!Number.isFinite(item.price) || item.price <= 0) {
    return undefined;
  }

  const condition = toCondition(item.condition);

  return {
    productTitle: item.title,
    provider: toProvider(item),
    priceAmount: item.price,
    currency: item.currency_id.toUpperCase(),
    region,
    ...(item.permalink !== undefined ? { url: item.permalink } : {}),
    ...(condition !== undefined ? { condition } : {}),
    raw: JSON.stringify(item),
  };
}

/**
 * Valida y mapea la respuesta de búsqueda de ML a una lista de `Offer`.
 * Lanza si la forma de nivel superior es inválida; descarta items individuales
 * malformados o de precio no interpretable (parseo defensivo).
 */
export function parseMlSearchResponse(data: unknown, region: string): readonly Offer[] {
  const parsed = mlSearchSchema.parse(data);

  const offers: Offer[] = [];
  for (const raw of parsed.results) {
    const item = mlItemSchema.safeParse(raw);
    if (!item.success) {
      continue;
    }
    const offer = toOffer(item.data, region);
    if (offer !== undefined) {
      offers.push(offer);
    }
  }

  return offers;
}
