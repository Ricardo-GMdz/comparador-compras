// Tests del programa CLI: verifican que el comando "comparar" y su opción
// "--region" existan y estén configurados según el contrato.

import { describe, it, expect } from "vitest";
import type { Command } from "commander";

import { buildProgram } from "./index.js";

/** Busca un subcomando por nombre dentro de un programa de commander. */
function findCommand(program: Command, name: string): Command | undefined {
  return program.commands.find((command) => command.name() === name);
}

describe("buildProgram", () => {
  it('expone un comando llamado "comparar"', () => {
    // Arrange
    const program = buildProgram();

    // Act
    const comparar = findCommand(program, "comparar");

    // Assert
    expect(comparar).toBeDefined();
  });

  it("declara el argumento posicional <producto> en el comando comparar", () => {
    // Arrange
    const program = buildProgram();

    // Act
    const comparar = findCommand(program, "comparar");
    const argumentNames = comparar?.registeredArguments.map((argument) => argument.name());

    // Assert
    expect(argumentNames).toContain("producto");
  });

  it("declara la opción --region en el comando comparar", () => {
    // Arrange
    const program = buildProgram();

    // Act
    const comparar = findCommand(program, "comparar");
    const regionOption = comparar?.options.find((option) => option.long === "--region");

    // Assert
    expect(regionOption).toBeDefined();
  });

  it('usa "global" como región por defecto', () => {
    // Arrange
    const program = buildProgram();

    // Act
    const comparar = findCommand(program, "comparar");
    const regionOption = comparar?.options.find((option) => option.long === "--region");

    // Assert
    expect(regionOption?.defaultValue).toBe("global");
  });
});
