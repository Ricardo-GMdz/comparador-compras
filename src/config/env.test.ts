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
    delete process.env.MERCADO_LIBRE_CLIENT_ID;
    delete process.env.MERCADO_LIBRE_CLIENT_SECRET;
    delete process.env.SOURCING_LOCALIDAD;
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

  test("expone las credenciales de MercadoLibre cuando ambas están presentes", () => {
    // Arrange
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.MERCADO_LIBRE_CLIENT_ID = "cid";
    process.env.MERCADO_LIBRE_CLIENT_SECRET = "csecret";

    // Act
    const env = loadEnv();

    // Assert
    expect(env.mercadoLibre).toEqual({ clientId: "cid", clientSecret: "csecret" });
  });

  test("omite MercadoLibre cuando falta una de las credenciales", () => {
    // Arrange: solo el client id, sin el secret.
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.MERCADO_LIBRE_CLIENT_ID = "cid";

    // Act
    const env = loadEnv();

    // Assert
    expect(env.mercadoLibre).toBeUndefined();
  });

  test("expone la localidad prioritaria del sourcing cuando está configurada", () => {
    // Arrange
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.SOURCING_LOCALIDAD = "San Nicolás de los Garza, NL";

    // Act
    const env = loadEnv();

    // Assert
    expect(env.sourcingLocalidad).toBe("San Nicolás de los Garza, NL");
  });

  test("omite la localidad cuando no está configurada o está vacía", () => {
    // Arrange
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.SOURCING_LOCALIDAD = "   ";

    // Act
    const env = loadEnv();

    // Assert
    expect(env.sourcingLocalidad).toBeUndefined();
  });

  test("omite MercadoLibre cuando no hay ninguna credencial", () => {
    // Arrange
    process.env.ANTHROPIC_API_KEY = "sk-test";

    // Act
    const env = loadEnv();

    // Assert
    expect(env.mercadoLibre).toBeUndefined();
  });
});
