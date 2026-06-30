// Esquema de validación y parseo defensivo de las ofertas que arma el modelo.
// El modelo devuelve JSON; nunca confiamos en su forma: validamos con zod en
// el límite (respuesta externa) y convertimos a `Offer` de forma inmutable.

import { z } from "zod";
import type { Offer, Provider } from "../domain/types.js";

// Cantidad máxima de ofertas que aceptamos de una sola respuesta del modelo.
// Acota el tamaño de la salida y evita procesar listas desmesuradas.
export const MAX_OFFERS_PER_RESPONSE = 50;

// Proveedor tal como lo arma el modelo. `trusted` es opcional: si falta,
// asumimos no confiable (criterio conservador) al mapear a `Provider`.
const rawProviderSchema = z.object({
  name: z.string().min(1),
  url: z.string().url().optional(),
  trusted: z.boolean().optional(),
});

// Oferta cruda emitida por el modelo. El precio puede venir como número o como
// string (ej. "1.299,00"); lo normalizamos a número en el parseo.
export const rawOfferSchema = z.object({
  productTitle: z.string().min(1),
  provider: rawProviderSchema,
  priceAmount: z.union([z.number(), z.string()]),
  currency: z.string().min(1),
  url: z.string().url().optional(),
});

// Lista de ofertas crudas. La validación de longitud máxima se aplica afuera,
// recortando antes de validar para no rechazar toda la respuesta por exceso.
export const rawOffersSchema = z.array(rawOfferSchema);

export type RawOffer = z.infer<typeof rawOfferSchema>;

// Cantidad de dígitos a la derecha de un separador que delata que es de miles.
// "1,299" -> 3 dígitos => separador de miles; "12,99" -> 2 => decimal.
const THOUSANDS_GROUP_SIZE = 3;

/**
 * Resuelve el rol de un único separador (coma o punto) que aparece una sola vez.
 * - Exactamente 3 dígitos a la derecha => separador de miles (se elimina).
 * - 1 o 2 dígitos => separador decimal (se convierte a punto).
 * Devuelve la cadena ya normalizada con punto decimal y sin separador de miles.
 */
function resolveSingleSeparator(cleaned: string, separator: string): string {
  const parts = cleaned.split(separator);

  // Si aparece más de una vez, sólo puede ser separador de miles (ej. 1,234,567).
  if (parts.length > 2) {
    return parts.join("");
  }

  const rightDigits = parts[1] ?? "";
  if (rightDigits.length === THOUSANDS_GROUP_SIZE) {
    // Grupo de 3 dígitos: separador de miles, lo eliminamos.
    return parts.join("");
  }

  // 1 o 2 dígitos: separador decimal, lo unificamos a punto.
  return `${parts[0]}.${rightDigits}`;
}

// Convierte un monto crudo (número o string localizado) a un número finito y
// positivo. Devuelve `undefined` si no se puede interpretar o si es <= 0, para
// descartar la oferta en el límite (un precio negativo o nulo no es de dominio).
function parsePriceAmount(raw: number | string): number | undefined {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : undefined;
  }

  // Un signo negativo en cualquier parte descarta la oferta: un precio negativo
  // no es un precio de dominio (no lo "saneamos" silenciosamente a positivo).
  if (raw.includes("-")) {
    return undefined;
  }

  // Quitamos símbolos de moneda y espacios, dejando dígitos y separadores.
  const cleaned = raw.replace(/[^0-9.,]/g, "").trim();
  if (cleaned.length === 0) {
    return undefined;
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // Conviven coma y punto: el último que aparece es el decimal y el otro,
    // necesariamente, el separador de miles.
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandsSep = decimalSep === "," ? "." : ",";
    normalized = cleaned.split(thousandsSep).join("");
    normalized = normalized.replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    // Sólo coma: decidimos su rol según los dígitos a su derecha.
    normalized = resolveSingleSeparator(cleaned, ",");
  } else if (lastDot >= 0) {
    // Sólo punto: mismo criterio (3 dígitos => miles, 1-2 => decimal).
    normalized = resolveSingleSeparator(cleaned, ".");
  } else {
    normalized = cleaned;
  }

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

// Construye un `Provider` inmutable a partir del proveedor crudo.
function toProvider(raw: RawOffer["provider"]): Provider {
  return {
    name: raw.name,
    ...(raw.url !== undefined ? { url: raw.url } : {}),
    trusted: raw.trusted ?? false,
  };
}

// Mapea una oferta cruda validada a `Offer`, asociándola a la región dada.
// Devuelve `undefined` si el precio no es interpretable (oferta descartada).
export function toOffer(raw: RawOffer, region: string): Offer | undefined {
  const priceAmount = parsePriceAmount(raw.priceAmount);
  if (priceAmount === undefined) {
    return undefined;
  }

  return {
    productTitle: raw.productTitle,
    provider: toProvider(raw.provider),
    priceAmount,
    currency: raw.currency.toUpperCase(),
    region,
    ...(raw.url !== undefined ? { url: raw.url } : {}),
    raw: JSON.stringify(raw),
  };
}
