// Carga de archivo .env al entorno usando la API nativa de Node, sin
// dependencias externas. En desarrollo el usuario pone su API key en un .env
// gitignoreado; en CI/producción se usan variables de entorno reales, por eso
// la ausencia del archivo no es un error.

import { existsSync } from "node:fs";

// Nombre por defecto del archivo de entorno en la raíz del proyecto.
const DEFAULT_ENV_FILE = ".env";

/**
 * Carga las variables del archivo .env (si existe) al `process.env`.
 *
 * No falla si el archivo no existe: se confía en las variables del entorno
 * real. Si la versión de Node no expone `process.loadEnvFile` (< 20.12), se
 * registra un aviso en stderr y se continúa sin abortar.
 */
export function loadDotenvIfPresent(path: string = DEFAULT_ENV_FILE): void {
  if (!existsSync(path)) {
    return;
  }

  try {
    process.loadEnvFile(path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Aviso: no se pudo cargar ${path}: ${detail}\n`);
  }
}
