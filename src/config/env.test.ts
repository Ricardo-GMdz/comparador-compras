// Tests de loadEnv: happy path (variable presente) y error (variable ausente o vacía).
// Se aísla process.env en cada test para evitar fugas de estado entre casos.

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { loadEnv } from "./env.js";

describe("loadEnv", () => {
  // Guardamos una copia del entorno original para restaurarlo tras cada test.
  const originalEnv = process.env;

  beforeEach(() => {
    // Arrange global: partimos de un entorno limpio y aislado en cada test.
    process.env = { ...originalEnv };
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("devuelve la API key cuando ANTHROPIC_API_KEY está presente", () => {
    // Arrange
    process.env.ANTHROPIC_API_KEY = "sk-test-123";

    // Act
    const env = loadEnv();

    // Assert
    expect(env).toEqual({ anthropicApiKey: "sk-test-123" });
  });

  test("recorta espacios alrededor de la API key", () => {
    // Arrange
    process.env.ANTHROPIC_API_KEY = "  sk-test-456  ";

    // Act
    const env = loadEnv();

    // Assert
    expect(env.anthropicApiKey).toBe("sk-test-456");
  });

  test("lanza un error claro cuando falta ANTHROPIC_API_KEY", () => {
    // Arrange: la variable ya fue eliminada en beforeEach.

    // Act + Assert
    expect(() => loadEnv()).toThrow(/ANTHROPIC_API_KEY/);
  });

  test("lanza un error cuando ANTHROPIC_API_KEY está vacía", () => {
    // Arrange
    process.env.ANTHROPIC_API_KEY = "   ";

    // Act + Assert
    expect(() => loadEnv()).toThrow(/Configuración de entorno inválida/);
  });
});
