// Fuente de proveedores basada en los server tools web_search/web_fetch del SDK de Anthropic.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Supplier, SupplierCandidate, SupplierContact } from "../domain/supplier.js";
import { logger } from "../logging/logger.js";
import { parseSuppliers } from "./supplierSchema.js";

const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 16000;
const WEB_SEARCH_TOOL_TYPE = "web_search_20260209";
const WEB_SEARCH_TOOL_NAME = "web_search";
const MAX_WEB_SEARCH_USES = 5;
// Reintentos extra cuando la búsqueda devuelve 0 proveedores.
const MAX_EMPTY_RETRIES = 1;
// Enriquecimiento de contacto: visitar la web del proveedor con web_fetch.
const WEB_FETCH_TOOL_TYPE = "web_fetch_20260209";
const WEB_FETCH_TOOL_NAME = "web_fetch";
const MAX_WEB_FETCH_USES = 3;
const MAX_ENRICH_SEARCH_USES = 2;

/** Consulta a la que responde una fuente de proveedores. */
export interface SupplierQuery {
  query: string;
  region: string;
}

/** Presupuesto opcional para acotar la búsqueda (deploy con límite de tiempo). */
export interface SearchBudget {
  maxWebSearchUses: number;
  maxEmptyRetries: number;
  maxTokens: number;
  /** Si está presente, thinking pasa a "enabled" con este budget; si no, "adaptive". */
  thinkingBudgetTokens?: number;
}

/** Dependencias: el cliente Anthropic (inyectable para tests). */
export interface SupplierSourceDeps {
  client: Anthropic;
  /** Localidad prioritaria del usuario (ej. "San Nicolás de los Garza, NL"). */
  localidad?: string;
  /** Acota la búsqueda para caber en un límite de tiempo (sin él: sin recortes). */
  searchBudget?: SearchBudget;
}

export interface SupplierSource {
  search(query: SupplierQuery): Promise<readonly SupplierCandidate[]>;
  /** Completa SOLO los campos de contacto faltantes; `{}` si no hay nada nuevo. */
  enrichContact(supplier: Supplier): Promise<SupplierContact>;
}

function buildSystemPrompt(): string {
  return [
    "Sos un asistente de sourcing B2B: encontrás PROVEEDORES (empresas/páginas que",
    "venden al por mayor) de un material/producto, para comprar y revender.",
    "Usá la búsqueda web para encontrar proveedores reales y sus datos de contacto.",
    "Respondé EXCLUSIVAMENTE con un objeto JSON (sin texto extra, sin ```), con la forma:",
    '{ "suppliers": [ { "name": string, "website"?: string, "material": string,',
    '  "wholesalePrice"?: number, "currency"?: string (ISO 4217), "moq"?: number,',
    '  "priceUnit"?: "pieza"|"kg"|"tonelada"|"m2",',
    '  "availability"?: "disponible"|"sobre pedido",',
    '  "catalogPrice"?: number (precio de lista/catálogo publicado, distinto del mayoreo),',
    '  "address"?: string (dirección o ciudad del proveedor si la publica),',
    '  "contact"?: { "email"?: string, "phone"?: string, "whatsapp"?: string, "formUrl"?: string },',
    '  "trusted"?: boolean, "notes"?: string } ] }.',
    'Cuando indiques "wholesalePrice", indicá también "priceUnit": la unidad a la que',
    "corresponde ese precio (por pieza, por kg, por tonelada o por m2).",
    'Indicá "availability" cuando el proveedor publique si tiene stock/entrega inmediata',
    "o si vende sobre pedido; si no lo publica, omití el campo (no lo inventes).",
    "Si el proveedor no publica precio de mayoreo, NO lo descartes: reportá el precio",
    "unitario disponible (o sin precio) — la falta de mayoreo no penaliza.",
    'Si el proveedor publica un precio de lista/catálogo (aunque no sea de mayoreo),',
    'reportalo en "catalogPrice" con su "currency". Si publica su dirección/ciudad,',
    'ponela en "address". No inventes ninguno de los dos: omitilos si no están.',
    'Marcá "trusted": true solo para empresas reconocidas/verificables (con datos de contacto reales).',
    'Priorizá precio y datos de contacto. Si no encontrás, devolvé { "suppliers": [] }.',
  ].join("\n");
}

function buildUserPrompt(q: SupplierQuery, localidad?: string): string {
  const lineas = [
    `Buscá proveedores al por mayor de: "${q.query}".`,
    `Región objetivo: "${q.region}". Preferí proveedores de esa región y su moneda.`,
  ];
  if (localidad !== undefined && localidad.trim().length > 0) {
    lineas.push(
      `PRIORIDAD 1: proveedores locales de ${localidad.trim()} o su zona metropolitana;`,
      "después el resto de la región. Indicá la ciudad del proveedor en 'notes' si la conocés.",
    );
  }
  lineas.push(
    "Priorizá también el costo del producto y, si el proveedor tiene stock/entrega",
    "inmediata, reportalo en 'availability'.",
    "Incluí su web y datos de contacto (email/teléfono/WhatsApp/formulario) cuando estén.",
  );
  return lineas.join("\n");
}

function buildEnrichSystemPrompt(): string {
  return [
    "Sos un asistente que completa datos de contacto de un proveedor B2B.",
    "Visitá el sitio web indicado (y buscá en la web solo si el sitio no alcanza)",
    "para encontrar datos de contacto REALES publicados por la empresa.",
    "No inventes datos: si un campo no aparece publicado, omitilo.",
    "Respondé EXCLUSIVAMENTE con un objeto JSON (sin texto extra, sin ```), con la forma:",
    '{ "contact": { "email"?: string, "phone"?: string, "whatsapp"?: string, "formUrl"?: string } }.',
    'Si no encontrás ningún dato, devolvé { "contact": {} }.',
  ].join("\n");
}

function buildEnrichUserPrompt(supplier: Supplier): string {
  return [
    `Proveedor: "${supplier.name}" (material: ${supplier.material}, región: ${supplier.region}).`,
    `Visitá su sitio: ${supplier.website ?? ""}`,
    "Extraé email, teléfono, WhatsApp y/o URL de formulario de contacto, si están publicados.",
  ].join("\n");
}

// Respuesta esperada del enriquecimiento; parseo defensivo (dato externo).
const enrichResponseSchema = z.object({
  contact: z
    .object({
      email: z.string().optional(),
      phone: z.string().optional(),
      whatsapp: z.string().optional(),
      formUrl: z.string().optional(),
    })
    .optional(),
});

/** Campos de contacto conocidos, en orden estable. */
const CONTACT_FIELDS = ["email", "phone", "whatsapp", "formUrl"] as const;

/** Deja solo los campos que `existing` no tiene (lo existente nunca se pisa). */
function onlyMissingContactFields(
  existing: SupplierContact,
  found: SupplierContact,
): SupplierContact {
  const entries = CONTACT_FIELDS.filter(
    (field) => existing[field] === undefined && found[field] !== undefined,
  ).map((field) => [field, found[field]] as const);
  return Object.fromEntries(entries) as SupplierContact;
}

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** Recorta el objeto JSON del texto si el modelo lo envuelve en prosa. */
function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("La respuesta del modelo no contiene un objeto JSON válido.");
  }
}

/** Crea una fuente de proveedores que usa web_search. */
export function createSupplierSource(deps: SupplierSourceDeps): SupplierSource {
  // Valores efectivos: si hay searchBudget se acotan, si no se usan los defaults.
  const maxWebSearchUses = deps.searchBudget?.maxWebSearchUses ?? MAX_WEB_SEARCH_USES;
  const maxEmptyRetries = deps.searchBudget?.maxEmptyRetries ?? MAX_EMPTY_RETRIES;
  const maxTokens = deps.searchBudget?.maxTokens ?? MAX_TOKENS;
  const thinking =
    deps.searchBudget?.thinkingBudgetTokens !== undefined
      ? ({ type: "enabled", budget_tokens: deps.searchBudget.thinkingBudgetTokens } as const)
      : ({ type: "adaptive" } as const);

  async function searchOnce(q: SupplierQuery): Promise<readonly SupplierCandidate[]> {
    const response = await deps.client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      thinking,
      system: buildSystemPrompt(),
      tools: [
        { type: WEB_SEARCH_TOOL_TYPE, name: WEB_SEARCH_TOOL_NAME, max_uses: maxWebSearchUses },
      ],
      messages: [{ role: "user", content: buildUserPrompt(q, deps.localidad) }],
    });

    const text = extractText(response.content);
    if (text.length === 0) {
      logger.warn("sourcing: el modelo no devolvió texto utilizable", {
        query: q.query,
        region: q.region,
      });
      return [];
    }
    return parseSuppliers(parseJsonObject(text), q.region);
  }

  // Busca con hasta maxEmptyRetries reintentos si la búsqueda viene vacía.
  async function search(q: SupplierQuery): Promise<readonly SupplierCandidate[]> {
    for (let attempt = 0; attempt <= maxEmptyRetries; attempt += 1) {
      const candidates = await searchOnce(q);
      if (candidates.length > 0) {
        return candidates;
      }
      if (attempt < maxEmptyRetries) {
        logger.warn("sourcing: búsqueda sin proveedores, reintentando", {
          query: q.query,
          region: q.region,
          attempt: attempt + 1,
        });
      }
    }
    return [];
  }

  // Visita la web del proveedor y devuelve SOLO los campos de contacto faltantes.
  async function enrichContact(supplier: Supplier): Promise<SupplierContact> {
    if (supplier.website === undefined) {
      logger.warn("enriquecer: el proveedor no tiene website, nada que visitar", {
        supplier: supplier.name,
      });
      return {};
    }

    const response = await deps.client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system: buildEnrichSystemPrompt(),
      tools: [
        { type: WEB_FETCH_TOOL_TYPE, name: WEB_FETCH_TOOL_NAME, max_uses: MAX_WEB_FETCH_USES },
        {
          type: WEB_SEARCH_TOOL_TYPE,
          name: WEB_SEARCH_TOOL_NAME,
          max_uses: MAX_ENRICH_SEARCH_USES,
        },
      ],
      messages: [{ role: "user", content: buildEnrichUserPrompt(supplier) }],
    });

    const text = extractText(response.content);
    if (text.length === 0) {
      logger.warn("enriquecer: el modelo no devolvió texto utilizable", {
        supplier: supplier.name,
      });
      return {};
    }

    const parsed = enrichResponseSchema.parse(parseJsonObject(text));
    return onlyMissingContactFields(supplier.contact, parsed.contact ?? {});
  }

  return { search, enrichContact };
}
