// Fuente de productos basada en el server tool `web_search` del SDK de Anthropic.
// El agente consulta internet con el modelo claude-opus-4-8 (adaptive thinking),
// y pedimos al modelo que devuelva las ofertas como JSON, que validamos con zod.

import Anthropic from "@anthropic-ai/sdk";
import type { Product, Offer } from "../domain/types.js";
import type { ProductSource } from "../domain/source.js";
import { logger } from "../logging/logger.js";
import { rawOfferSchema, toOffer, MAX_OFFERS_PER_RESPONSE } from "./offerSchema.js";

// Identificador estable de esta fuente (parte del contrato público).
export const WEB_SEARCH_SOURCE_ID = "web-search";

// Configuración del modelo y del server tool. Sin números mágicos sueltos.
const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 16000;
const WEB_SEARCH_TOOL_TYPE = "web_search_20260209";
const WEB_SEARCH_TOOL_NAME = "web_search";
// Límite de búsquedas del server tool por request, para acotar costo/latencia.
const MAX_WEB_SEARCH_USES = 5;
// Tope de reanudaciones ante `pause_turn` para evitar un bucle infinito si el
// server tool nunca llega a un `stop_reason` terminal.
const MAX_PAUSE_TURN_RESUMES = 3;

// Dependencias inyectables de la fuente. Solo necesitamos la API key.
export interface WebSearchSourceDeps {
  apiKey: string;
}

// Instrucciones del sistema: el modelo busca ofertas reales y responde SOLO con
// un arreglo JSON con la forma esperada. El parseo defensivo vive en el schema.
function buildSystemPrompt(): string {
  return [
    "Sos un asistente que compara precios de productos entre proveedores.",
    "Usá la herramienta de búsqueda web para encontrar ofertas reales y vigentes.",
    "Respondé EXCLUSIVAMENTE con un arreglo JSON (sin texto adicional, sin ```),",
    "donde cada elemento tiene la forma:",
    '{ "productTitle": string, "provider": { "name": string, "url"?: string, "trusted"?: boolean },',
    '  "priceAmount": number | string, "currency": string (ISO 4217), "url"?: string,',
    '  "variant"?: { "tierRank": number, "label"?: string },',
    '  "condition"?: "new" | "refurbished" | "used" }.',
    "Marcá trusted=true solo para tiendas reconocidas y confiables.",
    'Para "variant", compará la oferta con el producto buscado y asigná "tierRank":',
    "0 = misma gama/versión que lo buscado; un entero positivo = versión SUPERIOR",
    "(más capacidad, modelo más nuevo, Pro/Plus); un entero negativo = versión inferior.",
    'Usá "label" como descriptor corto de la variante (ej. "256GB", "Pro 256GB").',
    'Importante: "condition" es un eje SEPARADO de la variante; no codifiques el',
    'estado en "tierRank". Asigná "condition" = "new" (nuevo), "refurbished"',
    '(reacondicionado/renewed) o "used" (usado); omitilo si no estás seguro.',
    "Si no encontrás ofertas, respondé con un arreglo vacío [].",
  ].join("\n");
}

// Construye el mensaje del usuario a partir del producto y su región.
function buildUserPrompt(product: Product): string {
  return [
    `Buscá ofertas para el producto: "${product.query}".`,
    `Región objetivo: "${product.region}". Usá la moneda y tiendas propias de esa región.`,
    "Devolvé las mejores ofertas que encuentres como arreglo JSON.",
  ].join("\n");
}

// Extrae el texto plano de los bloques de respuesta del modelo. El server tool
// inyecta bloques propios (web_search_tool_result); solo nos interesa el texto.
function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

// Intenta parsear el texto del modelo como JSON. Tolera que el modelo envuelva
// el arreglo en prosa o en fences, extrayendo el primer arreglo de nivel raíz.
function parseJsonArray(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fallback: buscamos el primer "[" y el último "]" para recortar el arreglo.
    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("La respuesta del modelo no contiene un arreglo JSON válido.");
  }
}

// Crea una `ProductSource` que usa el server tool web_search del SDK.
export function createWebSearchSource(deps: WebSearchSourceDeps): ProductSource {
  if (deps.apiKey.trim().length === 0) {
    throw new Error("createWebSearchSource: apiKey no puede estar vacía.");
  }

  const client = new Anthropic({ apiKey: deps.apiKey });

  // Realiza una llamada al modelo, reanudando el turno mientras el server tool
  // devuelva `stop_reason === "pause_turn"` (búsqueda web larga que se pausa).
  // Reenvía el contenido del asistente como turno previo hasta llegar a un
  // `stop_reason` terminal o agotar el tope de reanudaciones.
  async function requestWithResume(product: Product): Promise<Anthropic.Messages.Message> {
    const messages: Anthropic.Messages.MessageParam[] = [
      { role: "user", content: buildUserPrompt(product) },
    ];

    let response: Anthropic.Messages.Message | undefined;

    for (let resume = 0; resume <= MAX_PAUSE_TURN_RESUMES; resume += 1) {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: "adaptive" },
        system: buildSystemPrompt(),
        tools: [
          {
            type: WEB_SEARCH_TOOL_TYPE,
            name: WEB_SEARCH_TOOL_NAME,
            max_uses: MAX_WEB_SEARCH_USES,
          },
        ],
        messages,
      });

      if (response.stop_reason !== "pause_turn") {
        return response;
      }

      // Reanudamos: agregamos el turno del asistente pausado y volvemos a pedir.
      logger.info("web-search: turno pausado por el server tool; reanudando", {
        query: product.query,
        region: product.region,
        resume: resume + 1,
      });
      messages.push({ role: "assistant", content: response.content });
    }

    // Si seguimos en `pause_turn` tras agotar el tope, devolvemos la última
    // respuesta y dejamos que el manejo de `stop_reason` registre el motivo.
    logger.warn("web-search: se agotaron las reanudaciones de pause_turn", {
      query: product.query,
      region: product.region,
    });
    // `response` siempre está asignada: el bucle corre al menos una vez.
    return response as Anthropic.Messages.Message;
  }

  async function search(product: Product): Promise<readonly Offer[]> {
    let response: Anthropic.Messages.Message;
    try {
      response = await requestWithResume(product);
    } catch (error: unknown) {
      // Errores de red/SDK: se registran con contexto y se propagan explícitos.
      const message = error instanceof Error ? error.message : String(error);
      logger.error("web-search: falló la llamada al SDK de Anthropic", {
        query: product.query,
        region: product.region,
        error: message,
      });
      throw new Error(`web-search: error consultando el modelo: ${message}`);
    }

    // Una respuesta truncada por tokens puede no contener el JSON completo:
    // lo dejamos trazable en vez de diagnosticarlo como "sin texto" o malformado.
    if (response.stop_reason === "max_tokens") {
      logger.warn("web-search: la respuesta del modelo se truncó por max_tokens", {
        query: product.query,
        region: product.region,
      });
    }

    const text = extractText(response.content);
    if (text.length === 0) {
      logger.warn("web-search: el modelo no devolvió texto utilizable", {
        query: product.query,
        region: product.region,
      });
      return [];
    }

    let parsed: unknown;
    try {
      parsed = parseJsonArray(text);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("web-search: no se pudo parsear el JSON del modelo", {
        query: product.query,
        region: product.region,
        error: message,
      });
      throw new Error(`web-search: respuesta del modelo no parseable: ${message}`);
    }

    // La raíz debe ser un arreglo; sólo eso aborta toda la fuente. Cada oferta
    // se valida por separado para no perder las buenas por una malformada
    // (parseo defensivo: descartar la inválida y continuar).
    if (!Array.isArray(parsed)) {
      logger.error("web-search: la respuesta del modelo no es un arreglo JSON", {
        query: product.query,
        region: product.region,
      });
      throw new Error("web-search: la respuesta del modelo no es un arreglo JSON.");
    }

    // Recortamos antes de validar para no procesar listas desmesuradas.
    const candidates = parsed.slice(0, MAX_OFFERS_PER_RESPONSE);

    // Mapeo inmutable a `Offer`: descartamos ofertas que no pasan el esquema o
    // cuyo precio no es interpretable, registrando cada descarte.
    const offers: Offer[] = [];
    for (const candidate of candidates) {
      const validation = rawOfferSchema.safeParse(candidate);
      if (!validation.success) {
        logger.warn("web-search: oferta descartada por no cumplir el esquema", {
          issues: validation.error.issues.length,
        });
        continue;
      }

      const offer = toOffer(validation.data, product.region);
      if (offer !== undefined) {
        offers.push(offer);
      } else {
        logger.warn("web-search: oferta descartada por precio inválido", {
          provider: validation.data.provider.name,
          priceAmount: validation.data.priceAmount,
        });
      }
    }

    return offers;
  }

  return {
    id: WEB_SEARCH_SOURCE_ID,
    search,
  };
}
