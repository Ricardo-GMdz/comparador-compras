// Wrapper fino sobre client.messages.create: única fuente de telemetría de
// costo del sourcing. Antes de este módulo, response.usage nunca se leía en
// ningún lado — cada búsqueda son varias llamadas a Opus con web_search sin
// un solo token registrado.

import type Anthropic from "@anthropic-ai/sdk";
import { logger } from "../logging/logger.js";
import { estimateCostUsd } from "./pricing.js";

/** Parámetros de una llamada al modelo (siempre no-streaming en este sourcing). */
export type CallModelParams = Anthropic.Messages.MessageCreateParamsNonStreaming;

/**
 * Contexto de logging: qué disparó la llamada, para correlacionar el log de
 * usage con la acción de negocio (búsqueda, enriquecimiento) sin acoplar
 * este wrapper a un dominio concreto.
 */
export interface CallModelContext {
  readonly action: string;
  readonly [key: string]: unknown;
}

/**
 * Ejecuta la llamada y, en éxito, loguea el uso de tokens y el costo
 * estimado. Un error se propaga sin loguear usage (no hubo respuesta que
 * medir); el logging del error queda a cargo del caller, que tiene más
 * contexto del negocio (query, proveedor, etc.).
 */
export async function callModel(
  client: Anthropic,
  params: CallModelParams,
  context: CallModelContext,
): Promise<Anthropic.Messages.Message> {
  const response = await client.messages.create(params);

  // `usage` viene siempre en la API real, pero se lee de forma defensiva: un
  // log de telemetría no puede tumbar una búsqueda ya respondida.
  const usage = response.usage as Anthropic.Messages.Usage | undefined;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const cacheCreationTokens = usage?.cache_creation_input_tokens ?? 0;
  const cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
  const webSearchRequests = usage?.server_tool_use?.web_search_requests ?? 0;
  const webFetchRequests = usage?.server_tool_use?.web_fetch_requests ?? 0;
  const estimatedCostUsd = estimateCostUsd({
    inputTokens,
    outputTokens,
    webSearchRequests,
    cacheCreationTokens,
    cacheReadTokens,
  });

  logger.info("llm_usage", {
    ...context,
    model: params.model,
    stopReason: response.stop_reason,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens: cacheCreationTokens,
    cacheReadInputTokens: cacheReadTokens,
    webSearchRequests,
    webFetchRequests,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)),
  });

  return response;
}
