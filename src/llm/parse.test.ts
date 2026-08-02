import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { extractText, parseJsonObject } from "./parse.js";

function textBlock(text: string): Anthropic.Messages.ContentBlock {
  return { type: "text", text, citations: null };
}

describe("extractText", () => {
  it("concatena los bloques de texto separados por salto de línea", () => {
    const content = [textBlock("primero"), textBlock("segundo")];
    expect(extractText(content)).toBe("primero\nsegundo");
  });

  it("descarta bloques que no son de texto (p.ej. server_tool_use)", () => {
    const content: Anthropic.Messages.ContentBlock[] = [
      {
        type: "server_tool_use",
        id: "x",
        name: "web_search",
        input: {},
        caller: { type: "direct" },
      },
      textBlock("único texto"),
    ];
    expect(extractText(content)).toBe("único texto");
  });

  it("recorta espacios al inicio/fin del resultado", () => {
    const content = [textBlock("  con espacios  ")];
    expect(extractText(content)).toBe("con espacios");
  });

  it("devuelve '' cuando no hay ningún bloque de texto", () => {
    expect(extractText([])).toBe("");
  });
});

describe("parseJsonObject", () => {
  it("parsea un objeto JSON directo", () => {
    expect(parseJsonObject('{"suppliers":[]}')).toEqual({ suppliers: [] });
  });

  it("recorta el objeto si el modelo lo envuelve en prosa", () => {
    const text = 'Acá tenés el resultado:\n{"suppliers":[]}\n¡Espero que sirva!';
    expect(parseJsonObject(text)).toEqual({ suppliers: [] });
  });

  it("recorta el objeto si el modelo lo envuelve en fences de código", () => {
    const text = '```json\n{"suppliers":[]}\n```';
    expect(parseJsonObject(text)).toEqual({ suppliers: [] });
  });

  it("lanza cuando el texto no contiene ningún objeto JSON", () => {
    expect(() => parseJsonObject("no hay nada acá")).toThrow(/no contiene un objeto JSON válido/);
  });
});
