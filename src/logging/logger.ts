// Logger estructurado simple: emite líneas JSON por nivel (info/warn/error).
// Sin dependencias pesadas; escribe a los streams estándar para no acoplar
// el resto del sistema a una librería de logging concreta.

/** Niveles de log soportados, en orden de severidad creciente. */
export type LogLevel = "info" | "warn" | "error";

/** Datos estructurados opcionales que acompañan a un mensaje de log. */
export type LogContext = Readonly<Record<string, unknown>>;

/** Entrada de log ya estructurada, lista para serializar. */
export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  /** Marca de tiempo en formato ISO 8601 (UTC). */
  readonly timestamp: string;
  readonly context?: LogContext;
}

/** Contrato público del logger usado por todos los módulos. */
export interface Logger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

// Mapeo de nivel a stream de salida: warn/error van a stderr, info a stdout.
// Se evita un número mágico de descriptores usando los streams nombrados.
const LEVEL_STREAMS: Readonly<Record<LogLevel, NodeJS.WritableStream>> = {
  info: process.stdout,
  warn: process.stderr,
  error: process.stderr,
};

/**
 * Construye una entrada de log inmutable a partir de sus partes.
 * No muta ningún argumento; siempre devuelve un objeto nuevo.
 */
export function buildLogEntry(level: LogLevel, message: string, context?: LogContext): LogEntry {
  // Solo se incluye `context` cuando trae claves, para no ensuciar la salida.
  const hasContext = context !== undefined && Object.keys(context).length > 0;
  return hasContext
    ? { level, message, timestamp: new Date().toISOString(), context }
    : { level, message, timestamp: new Date().toISOString() };
}

/**
 * Serializa una entrada a una línea JSON. Si la serialización falla
 * (por ejemplo, por referencias cíclicas en el contexto), no se traga el
 * error en silencio: se devuelve un JSON de respaldo que lo deja registrado.
 */
export function formatLogEntry(entry: LogEntry): string {
  try {
    return JSON.stringify(entry);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "error desconocido";
    return JSON.stringify({
      level: entry.level,
      message: entry.message,
      timestamp: entry.timestamp,
      serializationError: reason,
    });
  }
}

/**
 * Crea un logger que escribe entradas JSON en los streams indicados.
 * Se expone para poder inyectar streams en los tests sin tocar globals.
 */
export function createLogger(
  streams: Readonly<Record<LogLevel, NodeJS.WritableStream>> = LEVEL_STREAMS,
): Logger {
  const write = (level: LogLevel, message: string, context?: LogContext): void => {
    const entry = buildLogEntry(level, message, context);
    streams[level].write(`${formatLogEntry(entry)}\n`);
  };

  return {
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
  };
}

/** Logger por defecto compartido por toda la aplicación. */
export const logger: Logger = createLogger();
