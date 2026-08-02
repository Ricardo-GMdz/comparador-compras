import { describe, it, expect, vi, afterEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { logger } from "../logging/logger.js";
import { callModel } from "./callModel.js";

/** Cliente Anthropic mínimo mockeado: solo messages.create. */
function fakeClient(response: unknown) {
  const create = vi.fn(async (_params: unknown) => response);
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const BASE_RESPONSE = {
  stop_reason: "end_turn",
  content: [{ type: "text", text: "ok" }],
  usage: {
    input_tokens: 1200,
    output_tokens: 300,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 },
  },
};

const PARAMS = {
  model: "claude-opus-4-8",
  max_tokens: 16000,
  messages: [{ role: "user" as const, content: "hola" }],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("callModel", () => {
  it("llama a client.messages.create con los params tal cual y devuelve la respuesta", async () => {
    const { client, create } = fakeClient(BASE_RESPONSE);

    const response = await callModel(client, PARAMS, { action: "buscar" });

    expect(create).toHaveBeenCalledWith(PARAMS);
    expect(response).toBe(BASE_RESPONSE);
  });

  it("loguea el uso de tokens y el costo estimado tras una llamada exitosa", async () => {
    const { client } = fakeClient(BASE_RESPONSE);
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    await callModel(client, PARAMS, { action: "buscar", query: "lámina" });

    expect(info).toHaveBeenCalledWith(
      "llm_usage",
      expect.objectContaining({
        action: "buscar",
        query: "lámina",
        model: "claude-opus-4-8",
        stopReason: "end_turn",
        inputTokens: 1200,
        outputTokens: 300,
        webSearchRequests: 2,
        webFetchRequests: 0,
      }),
    );
  });

  it("incluye el costo estimado en USD calculado con estimateCostUsd", async () => {
    const { client } = fakeClient(BASE_RESPONSE);
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    await callModel(client, PARAMS, { action: "buscar" });

    // 1200 input ($0,006) + 300 output ($0,0075) + 2 búsquedas ($0,02) = $0,0335
    const [, context] = info.mock.calls[0] as [string, { estimatedCostUsd: number }];
    expect(context.estimatedCostUsd).toBeCloseTo(0.0335, 5);
  });

  it("no loguea si client.messages.create lanza (el error se propaga)", async () => {
    const create = vi.fn(async () => {
      throw new Error("boom");
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    await expect(callModel(client, PARAMS, { action: "buscar" })).rejects.toThrow("boom");
    expect(info).not.toHaveBeenCalled();
  });

  it("sin server_tool_use (respuesta sin tools), webSearchRequests/webFetchRequests son 0", async () => {
    const { client } = fakeClient({
      ...BASE_RESPONSE,
      usage: { ...BASE_RESPONSE.usage, server_tool_use: null },
    });
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    await callModel(client, PARAMS, { action: "enriquecer" });

    expect(info).toHaveBeenCalledWith(
      "llm_usage",
      expect.objectContaining({ webSearchRequests: 0, webFetchRequests: 0 }),
    );
  });

  it("no rompe la llamada si la respuesta viene sin usage (la telemetría nunca tumba el negocio)", async () => {
    const withoutUsage = { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] };
    const { client } = fakeClient(withoutUsage);
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    const response = await callModel(client, PARAMS, { action: "buscar" });

    expect(response).toBe(withoutUsage);
    expect(info).toHaveBeenCalledWith(
      "llm_usage",
      expect.objectContaining({ inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }),
    );
  });
});
