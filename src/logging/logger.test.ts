import { describe, expect, it, vi } from "vitest";

import { buildLogEntry, createLogger, formatLogEntry, type LogLevel } from "./logger.js";

// Stream de escritura falso que captura lo escrito para poder afirmarlo.
function createFakeStream(): {
  stream: NodeJS.WritableStream;
  writes: string[];
} {
  const writes: string[] = [];
  const stream = {
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return { stream, writes };
}

describe("buildLogEntry", () => {
  it("incluye nivel, mensaje y timestamp ISO en la entrada", () => {
    // Arrange
    const level: LogLevel = "info";

    // Act
    const entry = buildLogEntry(level, "hola");

    // Assert
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("hola");
    expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);
  });

  it("omite el contexto cuando es un objeto vacío", () => {
    // Arrange / Act
    const entry = buildLogEntry("warn", "sin datos", {});

    // Assert
    expect(entry.context).toBeUndefined();
  });

  it("conserva el contexto cuando tiene claves", () => {
    // Arrange / Act
    const entry = buildLogEntry("error", "con datos", { code: 42 });

    // Assert
    expect(entry.context).toEqual({ code: 42 });
  });

  it("no muta el contexto recibido", () => {
    // Arrange
    const context = { region: "global" };

    // Act
    buildLogEntry("info", "inmutable", context);

    // Assert
    expect(context).toEqual({ region: "global" });
  });
});

describe("formatLogEntry", () => {
  it("serializa una entrada a una línea JSON válida", () => {
    // Arrange
    const entry = buildLogEntry("info", "ok", { a: 1 });

    // Act
    const line = formatLogEntry(entry);

    // Assert
    expect(JSON.parse(line)).toMatchObject({
      level: "info",
      message: "ok",
      context: { a: 1 },
    });
  });

  it("no lanza y reporta el error cuando el contexto tiene ciclos", () => {
    // Arrange: contexto con referencia cíclica que rompe JSON.stringify.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const entry = buildLogEntry("error", "ciclo", cyclic);

    // Act
    const line = formatLogEntry(entry);

    // Assert
    expect(JSON.parse(line)).toMatchObject({
      level: "error",
      message: "ciclo",
    });
    expect(JSON.parse(line)).toHaveProperty("serializationError");
  });
});

describe("createLogger", () => {
  it("escribe en el stream correspondiente a cada nivel", () => {
    // Arrange
    const info = createFakeStream();
    const warn = createFakeStream();
    const error = createFakeStream();
    const log = createLogger({
      info: info.stream,
      warn: warn.stream,
      error: error.stream,
    });

    // Act
    log.info("i");
    log.warn("w");
    log.error("e");

    // Assert
    expect(info.writes).toHaveLength(1);
    expect(warn.writes).toHaveLength(1);
    expect(error.writes).toHaveLength(1);
  });

  it("emite cada entrada como línea JSON terminada en salto de línea", () => {
    // Arrange
    const fake = createFakeStream();
    const log = createLogger({
      info: fake.stream,
      warn: fake.stream,
      error: fake.stream,
    });

    // Act
    log.info("hola", { region: "us" });

    // Assert
    const written = fake.writes[0];
    expect(written.endsWith("\n")).toBe(true);
    expect(JSON.parse(written.trim())).toMatchObject({
      level: "info",
      message: "hola",
      context: { region: "us" },
    });
  });

  it("no rompe al loguear sin contexto", () => {
    // Arrange
    const fake = createFakeStream();
    const log = createLogger({
      info: fake.stream,
      warn: fake.stream,
      error: fake.stream,
    });

    // Act / Assert: no debe lanzar.
    expect(() => log.warn("solo mensaje")).not.toThrow();
  });
});

describe("logger por defecto", () => {
  it("expone info/warn/error y no lanza al usarse", async () => {
    // Arrange: se silencia stdout/stderr para no contaminar la salida del test.
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const { logger } = await import("./logger.js");

    // Act / Assert
    expect(() => {
      logger.info("i");
      logger.warn("w");
      logger.error("e");
    }).not.toThrow();

    // Cleanup
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("enruta info/warn/error a stderr y nunca a stdout", async () => {
    // Arrange: stdout queda reservado para la salida del programa.
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const { logger } = await import("./logger.js");

    // Act
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    // Assert
    expect(stderrSpy).toHaveBeenCalledTimes(3);
    expect(stdoutSpy).not.toHaveBeenCalled();

    // Cleanup
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
