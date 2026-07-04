// Validación y parseo defensivo de la respuesta del modelo → SupplierCandidate[].

import { z } from "zod";
import type { SupplierCandidate, SupplierContact } from "../domain/supplier.js";

const rawContactSchema = z.object({
  email: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  formUrl: z.string().optional(),
});

const rawSupplierSchema = z.object({
  name: z.string().min(1),
  website: z.string().optional(),
  material: z.string().min(1),
  wholesalePrice: z.number().optional(),
  currency: z.string().optional(),
  moq: z.number().optional(),
  contact: rawContactSchema.optional(),
  trusted: z.boolean().optional(),
  notes: z.string().optional(),
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
    ...(raw.notes !== undefined ? { notes: raw.notes } : {}),
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
