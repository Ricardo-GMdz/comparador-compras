import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDotenvIfPresent } from "./loadDotenv.js";

// Variable de prueba con nombre único para no pisar el entorno real.
const TEST_VAR = "COMPARADOR_TEST_DOTENV_VAR";

describe("loadDotenvIfPresent", () => {
  afterEach(() => {
    delete process.env[TEST_VAR];
  });

  it("carga las variables de un archivo .env existente al process.env", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "comparador-env-"));
    const file = join(dir, ".env");
    writeFileSync(file, `${TEST_VAR}=valor-de-prueba\n`);

    // Act
    loadDotenvIfPresent(file);

    // Assert
    expect(process.env[TEST_VAR]).toBe("valor-de-prueba");
    rmSync(dir, { recursive: true, force: true });
  });

  it("no lanza ni modifica el entorno si el archivo no existe", () => {
    // Arrange
    const missing = join(tmpdir(), "comparador-no-existe-.env");

    // Act + Assert
    expect(() => loadDotenvIfPresent(missing)).not.toThrow();
    expect(process.env[TEST_VAR]).toBeUndefined();
  });
});
