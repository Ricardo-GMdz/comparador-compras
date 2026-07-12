// Configuración de entorno para el deploy en Vercel: valida con zod las
// variables extra (clave de acceso + Redis) además de la API key de Anthropic.
// Separado de config/env.ts para NO exigir estas variables en el entry local.

import { z } from "zod";

/** Variables de entorno validadas del deploy en Vercel. */
export interface VercelEnv {
  anthropicApiKey: string;
  accessKey: string;
  upstashUrl: string;
  upstashToken: string;
  sourcingLocalidad?: string;
}

const required = (name: string) =>
  z.string({ message: `Falta la variable de entorno ${name}` }).trim().min(1, {
    message: `${name} no puede estar vacía`,
  });

const schema = z.object({
  ANTHROPIC_API_KEY: required("ANTHROPIC_API_KEY"),
  ACCESS_KEY: required("ACCESS_KEY"),
  UPSTASH_REDIS_REST_URL: required("UPSTASH_REDIS_REST_URL"),
  UPSTASH_REDIS_REST_TOKEN: required("UPSTASH_REDIS_REST_TOKEN"),
  SOURCING_LOCALIDAD: z.string().optional(),
});

/** Carga y valida el entorno de Vercel (por defecto lee de `process.env`). */
export function loadVercelEnv(source: NodeJS.ProcessEnv = process.env): VercelEnv {
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((i) => i.message).join("; ");
    throw new Error(`Configuración de entorno inválida: ${details}`);
  }
  const localidad = result.data.SOURCING_LOCALIDAD?.trim();
  return {
    anthropicApiKey: result.data.ANTHROPIC_API_KEY,
    accessKey: result.data.ACCESS_KEY,
    upstashUrl: result.data.UPSTASH_REDIS_REST_URL,
    upstashToken: result.data.UPSTASH_REDIS_REST_TOKEN,
    ...(localidad !== undefined && localidad.length > 0 ? { sourcingLocalidad: localidad } : {}),
  };
}
