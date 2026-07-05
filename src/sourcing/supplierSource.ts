// Fuente de proveedores basada en el server tool web_search del SDK de Anthropic.

import type Anthropic from "@anthropic-ai/sdk";
import type { SupplierCandidate } from "../domain/supplier.js";
import { logger } from "../logging/logger.js";
import { parseSuppliers } from "./supplierSchema.js";

const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 16000;
const WEB_SEARCH_TOOL_TYPE = "web_search_20260209";
const WEB_SEARCH_TOOL_NAME = "web_search";
const MAX_WEB_SEARCH_USES = 5;
// Reintentos extra cuando la búsqueda devuelve 0 proveedores.
const MAX_EMPTY_RETRIES = 1;

/** Consulta a la que responde una fuente de proveedores. */
export interface SupplierQuery {
  query: string;
  region: string;
}

/** Dependencias: el cliente Anthropic (inyectable para tests). */
export interface SupplierSourceDeps {
  client: Anthropic;
}

export interface SupplierSource {
  search(query: SupplierQuery): Promise<readonly SupplierCandidate[]>;
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
    '  "contact"?: { "email"?: string, "phone"?: string, "whatsapp"?: string, "formUrl"?: string },',
    '  "trusted"?: boolean, "notes"?: string } ] }.',
    'Cuando indiques "wholesalePrice", indicá también "priceUnit": la unidad a la que',
    "corresponde ese precio (por pieza, por kg, por tonelada o por m2).",
    'Marcá "trusted": true solo para empresas reconocidas/verificables (con datos de contacto reales).',
    'Priorizá precio de mayoreo y datos de contacto. Si no encontrás, devolvé { "suppliers": [] }.',
  ].join("\n");
}

function buildUserPrompt(q: SupplierQuery): string {
  return [
    `Buscá proveedores al por mayor de: "${q.query}".`,
    `Región objetivo: "${q.region}". Preferí proveedores de esa región y su moneda.`,
    "Incluí su web y datos de contacto (email/teléfono/WhatsApp/formulario) cuando estén.",
  ].join("\n");
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
  async function searchOnce(q: SupplierQuery): Promise<readonly SupplierCandidate[]> {
    const response = await deps.client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system: buildSystemPrompt(),
      tools: [
        { type: WEB_SEARCH_TOOL_TYPE, name: WEB_SEARCH_TOOL_NAME, max_uses: MAX_WEB_SEARCH_USES },
      ],
      messages: [{ role: "user", content: buildUserPrompt(q) }],
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

  // Busca con hasta MAX_EMPTY_RETRIES reintentos si la búsqueda viene vacía.
  async function search(q: SupplierQuery): Promise<readonly SupplierCandidate[]> {
    for (let attempt = 0; attempt <= MAX_EMPTY_RETRIES; attempt += 1) {
      const candidates = await searchOnce(q);
      if (candidates.length > 0) {
        return candidates;
      }
      if (attempt < MAX_EMPTY_RETRIES) {
        logger.warn("sourcing: búsqueda sin proveedores, reintentando", {
          query: q.query,
          region: q.region,
          attempt: attempt + 1,
        });
      }
    }
    return [];
  }

  return { search };
}
