// Precios vigentes de Anthropic para claude-opus-4-8 (2026-07): $5/MTok de
// input, $25/MTok de output (incluye el thinking, que se factura como
// output). web_search tiene un fee de $10 cada 1.000 búsquedas ejecutadas
// ($0.01 c/u), además de los tokens de los resultados (ya contados en
// input_tokens); web_fetch no tiene fee por uso, solo tokens.
const INPUT_USD_PER_MILLION_TOKENS = 5;
const OUTPUT_USD_PER_MILLION_TOKENS = 25;
const WEB_SEARCH_USD_PER_USE = 0.01;
// Prompt caching: escribir a caché cuesta 1,25× el precio de input (TTL de 5
// min, el default) y leer de caché 0,1×.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/** Uso de una llamada, en las unidades que necesita la estimación de costo. */
export interface UsageCost {
  inputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
  /** Tokens escritos a caché. `input_tokens` NO los incluye. */
  cacheCreationTokens?: number;
  /** Tokens leídos de caché. `input_tokens` NO los incluye. */
  cacheReadTokens?: number;
}

/**
 * Estimación de costo en USD de una llamada al modelo. Es una aproximación
 * para dimensionar gasto (no una factura exacta — la consola de Anthropic es
 * la fuente de verdad).
 *
 * Los tokens de entrada de una llamada son la suma de `input_tokens`,
 * `cache_creation_input_tokens` y `cache_read_input_tokens`: los cacheados NO
 * están dentro de `input_tokens`, así que se cobran aparte con su multiplicador
 * o el costo quedaría subestimado. Hoy el sourcing no usa `cache_control` y esos
 * campos vienen en cero, pero el cálculo ya queda correcto si se activa.
 *
 * Salvedades: asume el TTL de caché de 5 min (con TTL de 1h la escritura es 2×,
 * y `usage` no distingue ambos en este cálculo) y no cobra fee por `web_fetch`
 * (no tiene). Los precios son los de `claude-opus-4-8`, el único modelo que usa
 * este sourcing; con otro modelo la estimación deja de ser válida.
 */
export function estimateCostUsd(usage: UsageCost): number {
  const inputCostPerToken = INPUT_USD_PER_MILLION_TOKENS / 1_000_000;
  const tokenCostUsd =
    usage.inputTokens * inputCostPerToken +
    (usage.cacheCreationTokens ?? 0) * inputCostPerToken * CACHE_WRITE_MULTIPLIER +
    (usage.cacheReadTokens ?? 0) * inputCostPerToken * CACHE_READ_MULTIPLIER +
    (usage.outputTokens / 1_000_000) * OUTPUT_USD_PER_MILLION_TOKENS;
  const webSearchCostUsd = usage.webSearchRequests * WEB_SEARCH_USD_PER_USE;
  return tokenCostUsd + webSearchCostUsd;
}
