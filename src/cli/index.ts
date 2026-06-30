// Definición del programa CLI con commander.
// El comando principal "comparar" toma un producto y una región, ejecuta la
// comparación y muestra el resultado en consola.

import { Command } from "commander";

import { loadEnv } from "../config/env.js";
import { createWebSearchSource } from "../sources/webSearchSource.js";
import { runComparison } from "../agent/runner.js";
import { logger } from "../logging/logger.js";
import { renderComparison } from "./render.js";

// Metadatos del programa. Se mantienen como constantes para evitar
// strings mágicos dispersos por el archivo.
const PROGRAM_NAME = "comparar";
const PROGRAM_DESCRIPTION =
  "Compara precios de un producto entre proveedores y recomienda la mejor opción";
const PROGRAM_VERSION = "0.1.0";

// Región por defecto: deliberadamente "global" para no hardcodear un país.
const DEFAULT_REGION = "global";

/** Opciones parseadas del comando "comparar". */
interface CompararOptions {
  region: string;
}

/**
 * Ejecuta el flujo de comparación para un producto y región dados.
 * Maneja los errores de forma explícita: registra el detalle y marca el
 * proceso con código de salida distinto de cero, sin tragar la excepción.
 */
async function handleComparar(producto: string, options: CompararOptions): Promise<void> {
  try {
    // Validamos el entorno al inicio: falla rápido si falta la API key.
    const env = loadEnv();

    const source = createWebSearchSource({ apiKey: env.anthropicApiKey });

    const result = await runComparison({
      query: producto,
      region: options.region,
      sources: [source],
    });

    // El resultado es la SALIDA del programa: va a stdout en texto plano, para
    // que se pueda redirigir o parsear sin el ruido de los logs (que van a
    // stderr). El render produce el string; la escritura es el efecto de I/O.
    process.stdout.write(`${renderComparison(result)}\n`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error inesperado";
    logger.error("Falló la comparación", { message });
    // Señalamos el fallo al shell sin abortar el proceso de forma abrupta.
    process.exitCode = 1;
  }
}

/**
 * Construye el programa de commander con el comando "comparar".
 * No parsea argv; eso queda a cargo del entry point (`src/index.ts`),
 * lo que facilita testear la estructura del programa de forma aislada.
 */
export function buildProgram(): Command {
  const program = new Command();

  program.name(PROGRAM_NAME).description(PROGRAM_DESCRIPTION).version(PROGRAM_VERSION);

  program
    .command("comparar")
    .description("Busca y compara ofertas de un producto en internet")
    .argument("<producto>", 'Producto a comparar (ej. "notebook 16GB RAM")')
    .option("--region <code>", "Código de región que condiciona moneda y tiendas", DEFAULT_REGION)
    .action(handleComparar);

  return program;
}
