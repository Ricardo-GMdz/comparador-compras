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
});
