// Validación y parseo defensivo de la respuesta del modelo → SupplierCandidate[].

import { z } from "zod";
import type {
  Availability,
  PriceUnit,
  SupplierCandidate,
  SupplierContact,
} from "../domain/supplier.js";

// Mapa de normalización: texto libre del modelo → unidad de precio canónica.
// Las claves se comparan en minúsculas y sin el prefijo "por ".
const PRICE_UNIT_MAP: Readonly<Record<string, PriceUnit>> = {
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogramo: "kg",
  kilogramos: "kg",
  pieza: "pieza",
  piezas: "pieza",
  pza: "pieza",
  unidad: "pieza",
  unidades: "pieza",
  "c/u": "pieza",
  ton: "tonelada",
  tonelada: "tonelada",
  toneladas: "tonelada",
  m2: "m2",
  "m²": "m2",
  "metro cuadrado": "m2",
  "metros cuadrados": "m2",
};

/** Normaliza la unidad textual del modelo; undefined si no se reconoce. */
function normalizePriceUnit(raw: string | undefined): PriceUnit | undefined {
  if (raw === undefined) return undefined;
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/^por\s+/, "");
  return PRICE_UNIT_MAP[key];
}

// Mapa de normalización de disponibilidad: texto libre del modelo → canónico.
const AVAILABILITY_MAP: Readonly<Record<string, Availability>> = {
  disponible: "disponible",
  "en stock": "disponible",
  "in stock": "disponible",
  stock: "disponible",
  inmediata: "disponible",
  "entrega inmediata": "disponible",
  "sobre pedido": "sobre_pedido",
  sobre_pedido: "sobre_pedido",
  "bajo pedido": "sobre_pedido",
  "a pedido": "sobre_pedido",
  backorder: "sobre_pedido",
  "por encargo": "sobre_pedido",
};

/** Normaliza la disponibilidad textual del modelo; undefined si no se reconoce. */
function normalizeAvailability(raw: string | undefined): Availability | undefined {
  if (raw === undefined) return undefined;
  return AVAILABILITY_MAP[raw.trim().toLowerCase()];
}

const rawContactSchema = z.object({
  email: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  formUrl: z.string().optional(),
});

// Si cambian campos/enums acá, actualizar SUPPLIERS_OUTPUT_FORMAT en supplierSource.ts.
const rawSupplierSchema = z.object({
  name: z.string().min(1),
  website: z.string().optional(),
  material: z.string().min(1),
  wholesalePrice: z.number().optional(),
  currency: z.string().optional(),
  moq: z.number().optional(),
  priceUnit: z.string().optional(),
  availability: z.string().optional(),
  contact: rawContactSchema.optional(),
  trusted: z.boolean().optional(),
  notes: z.string().optional(),
  catalogPrice: z.number().optional(),
  address: z.string().optional(),
});

const rawResponseSchema = z.object({ suppliers: z.array(z.unknown()) });

type RawSupplier = z.infer<typeof rawSupplierSchema>;

/** Precio válido: número finito y positivo; si no, undefined (no descarta al proveedor). */
function validPrice(price: number | undefined): number | undefined {
  return price !== undefined && Number.isFinite(price) && price > 0 ? price : undefined;
}

/** Contacto limpio: solo campos presentes y no vacíos. */
function toContact(raw: RawSupplier["contact"]): SupplierContact {
  const c = raw ?? {};
  const pick = (v: string | undefined): string | undefined =>
    v !== undefined && v.trim().length > 0 ? v.trim() : undefined;
  const contact: SupplierContact = {};
  const email = pick(c.email);
  const phone = pick(c.phone);
  const whatsapp = pick(c.whatsapp);
  const formUrl = pick(c.formUrl);
  if (email !== undefined) contact.email = email;
  if (phone !== undefined) contact.phone = phone;
  if (whatsapp !== undefined) contact.whatsapp = whatsapp;
  if (formUrl !== undefined) contact.formUrl = formUrl;
  return contact;
}

function toCandidate(raw: RawSupplier, region: string): SupplierCandidate {
  const wholesalePrice = validPrice(raw.wholesalePrice);
  const priceUnit = normalizePriceUnit(raw.priceUnit);
  const availability = normalizeAvailability(raw.availability);
  const catalogPrice = validPrice(raw.catalogPrice);
  const address =
    raw.address !== undefined && raw.address.trim().length > 0 ? raw.address.trim() : undefined;
  return {
    name: raw.name,
    material: raw.material,
    region,
    trusted: raw.trusted ?? false,
    contact: toContact(raw.contact),
    ...(raw.website !== undefined ? { website: raw.website } : {}),
    ...(wholesalePrice !== undefined ? { wholesalePrice } : {}),
    ...(raw.currency !== undefined ? { currency: raw.currency } : {}),
    ...(raw.moq !== undefined ? { moq: raw.moq } : {}),
    ...(priceUnit !== undefined ? { priceUnit } : {}),
    ...(availability !== undefined ? { availability } : {}),
    ...(raw.notes !== undefined ? { notes: raw.notes } : {}),
    ...(catalogPrice !== undefined ? { catalogPrice } : {}),
    ...(address !== undefined ? { address } : {}),
  };
}

/**
 * Valida la respuesta del modelo y mapea a `SupplierCandidate[]`. Lanza si el
 * nivel superior no es `{ suppliers: [...] }`; descarta items individuales
 * malformados (parseo defensivo).
 */
export function parseSuppliers(data: unknown, region: string): readonly SupplierCandidate[] {
  const parsed = rawResponseSchema.parse(data);
  const candidates: SupplierCandidate[] = [];
  for (const raw of parsed.suppliers) {
    const item = rawSupplierSchema.safeParse(raw);
    if (item.success) {
      candidates.push(toCandidate(item.data, region));
    }
  }
  return candidates;
}
