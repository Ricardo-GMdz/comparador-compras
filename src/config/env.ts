// Configuración de entorno: valida las variables necesarias con zod y
// falla rápido con un mensaje claro si falta o es inválida alguna.

import { z } from "zod";

/** Variables de entorno validadas que el resto de la app puede consumir. */
export interface Env {
  anthropicApiKey: string;
}

// Nombre de la variable de entorno con la API key de Anthropic.
// Se usa como constante para evitar números/strings mágicos repetidos.
const ANTHROPIC_API_KEY_VAR = "ANTHROPIC_API_KEY";

// Esquema de validación del entorno. La API key debe ser un string no vacío.
const envSchema = z.object({
  [ANTHROPIC_API_KEY_VAR]: z
    .string({ message: `Falta la variable de entorno ${ANTHROPIC_API_KEY_VAR}` })
    .trim()
    .min(1, { message: `${ANTHROPIC_API_KEY_VAR} no puede estar vacía` }),
});

/**
 * Carga y valida las variables de entorno requeridas.
 * Falla rápido lanzando un Error con un mensaje legible si la validación falla.
 */
export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    // Concatenamos los mensajes de cada issue para dar contexto claro al usuario.
    const details = result.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Configuración de entorno inválida: ${details}`);
  }

  // Devolvemos un objeto nuevo (inmutable hacia afuera) con el shape de Env.
  return {
    anthropicApiKey: result.data[ANTHROPIC_API_KEY_VAR],
  };
}
