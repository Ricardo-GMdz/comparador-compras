// Precios vigentes de Anthropic para claude-opus-4-8 (2026-07): $5/MTok de
// input, $25/MTok de output (incluye el thinking, que se factura como
// output). web_search tiene un fee de $10 cada 1.000 búsquedas ejecutadas
// ($0.01 c/u), además de los tokens de los resultados (ya contados en
// input_tokens); web_fetch no tiene fee por uso, solo tokens.
const INPUT_USD_PER_MILLION_TOKENS = 5;
const OUTPUT_USD_PER_MILLION_TOKENS = 25;
const WEB_SEARCH_USD_PER_USE = 0.01;

/** Uso de una llamada, en las unidades que necesita la estimación de costo. */
export interface UsageCost {
  inputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
}

/**
 * Estimación de costo en USD de una llamada al modelo. Es una aproximación
 * para dimensionar gasto (no una factura exacta — la consola de Anthropic es
 * la fuente de verdad): no descuenta prompt caching (cache_read se factura a
 * ~0.1× pero hoy el sourcing no usa cache_control) ni cobra fee por web_fetch
 * (no lo tiene).
 */
export function estimateCostUsd(usage: UsageCost): number {
  const tokenCostUsd =
    (usage.inputTokens / 1_000_000) * INPUT_USD_PER_MILLION_TOKENS +
    (usage.outputTokens / 1_000_000) * OUTPUT_USD_PER_MILLION_TOKENS;
  const webSearchCostUsd = usage.webSearchRequests * WEB_SEARCH_USD_PER_USE;
  return tokenCostUsd + webSearchCostUsd;
}
