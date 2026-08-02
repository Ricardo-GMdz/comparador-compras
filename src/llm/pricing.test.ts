import { describe, it, expect } from "vitest";
import { estimateCostUsd } from "./pricing.js";

describe("estimateCostUsd", () => {
  it("calcula el costo de tokens de input y output a los precios de Opus 4.8", () => {
    // 1_000_000 input a $5/MTok + 1_000_000 output a $25/MTok = $30, sin búsquedas.
    const cost = estimateCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      webSearchRequests: 0,
    });
    expect(cost).toBeCloseTo(30, 5);
  });

  it("suma el fee de $0.01 por cada búsqueda web ejecutada", () => {
    const cost = estimateCostUsd({ inputTokens: 0, outputTokens: 0, webSearchRequests: 5 });
    expect(cost).toBeCloseTo(0.05, 5);
  });

  it("con 0 tokens y 0 búsquedas, el costo es 0", () => {
    const cost = estimateCostUsd({ inputTokens: 0, outputTokens: 0, webSearchRequests: 0 });
    expect(cost).toBe(0);
  });

  it("combina tokens y búsquedas en una llamada realista", () => {
    // 12.000 input ($0,06) + 1.500 output ($0,0375) + 2 búsquedas ($0,02) = $0,1175
    const cost = estimateCostUsd({
      inputTokens: 12_000,
      outputTokens: 1_500,
      webSearchRequests: 2,
    });
    expect(cost).toBeCloseTo(0.1175, 5);
  });

  // input_tokens NO incluye los tokens cacheados: el total de entrada es
  // input_tokens + cache_creation + cache_read. Si no se suman aparte, el costo
  // queda SUBestimado en cuanto se active el prompt caching.
  it("cobra la escritura de caché a 1,25× el precio de input", () => {
    // 1_000_000 tokens escritos a caché = $5 × 1,25 = $6,25
    const cost = estimateCostUsd({
      inputTokens: 0,
      outputTokens: 0,
      webSearchRequests: 0,
      cacheCreationTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(6.25, 5);
  });

  it("cobra la lectura de caché a 0,1× el precio de input", () => {
    // 1_000_000 tokens leídos de caché = $5 × 0,1 = $0,50
    const cost = estimateCostUsd({
      inputTokens: 0,
      outputTokens: 0,
      webSearchRequests: 0,
      cacheReadTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.5, 5);
  });

  it("los tokens de caché son opcionales: omitirlos equivale a cero", () => {
    const sinCache = estimateCostUsd({
      inputTokens: 12_000,
      outputTokens: 1_500,
      webSearchRequests: 2,
    });
    const conCacheEnCero = estimateCostUsd({
      inputTokens: 12_000,
      outputTokens: 1_500,
      webSearchRequests: 2,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
    expect(sinCache).toBe(conCacheEnCero);
  });
});
