// Parseo defensivo de la respuesta del modelo: extraer el texto plano de los
// bloques de contenido y recortar el JSON si viene envuelto en prosa/fences.

import type Anthropic from "@anthropic-ai/sdk";

/** Extrae el texto plano de los bloques de respuesta del modelo. Los bloques
 * de server tools (p.ej. web_search_tool_result) se descartan: solo interesa
 * el texto final. */
export function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** Recorta el objeto JSON del texto si el modelo lo envuelve en prosa o fences. */
export function parseJsonObject(text: string): unknown {
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
