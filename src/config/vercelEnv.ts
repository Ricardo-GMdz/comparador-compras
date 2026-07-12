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
  z
    .string({ message: `Falta la variable de entorno ${name}` })
    .trim()
    .min(1, {
      message: `${name} no puede estar vacía`,
    });

const schema = z.object({
  ANTHROPIC_API_KEY: required("ANTHROPIC_API_KEY"),
  ACCESS_KEY: required("ACCESS_KEY"),
  // Redis: la integración de Upstash en Vercel inyecta las credenciales REST con
  // nombres KV_* (KV_REST_API_URL/TOKEN); las viejas integraciones o el uso manual
  // usan UPSTASH_*. Aceptamos ambos esquemas (UPSTASH_* tiene prioridad).
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  KV_REST_API_URL: z.string().optional(),
  KV_REST_API_TOKEN: z.string().optional(),
  SOURCING_LOCALIDAD: z.string().optional(),
});

/** Carga y valida el entorno de Vercel (por defecto lee de `process.env`). */
export function loadVercelEnv(source: NodeJS.ProcessEnv = process.env): VercelEnv {
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((i) => i.message).join("; ");
    throw new Error(`Configuración de entorno inválida: ${details}`);
  }
  const { data } = result;
  // UPSTASH_* tiene prioridad; si no, caemos a los KV_* de la integración de Vercel.
  const upstashUrl = (data.UPSTASH_REDIS_REST_URL ?? data.KV_REST_API_URL)?.trim();
  const upstashToken = (data.UPSTASH_REDIS_REST_TOKEN ?? data.KV_REST_API_TOKEN)?.trim();
  if (
    upstashUrl === undefined ||
    upstashUrl.length === 0 ||
    upstashToken === undefined ||
    upstashToken.length === 0
  ) {
    throw new Error(
      "Configuración de entorno inválida: falta la URL/token de Redis " +
        "(UPSTASH_REDIS_REST_URL/TOKEN o KV_REST_API_URL/TOKEN).",
    );
  }
  const localidad = data.SOURCING_LOCALIDAD?.trim();
  return {
    anthropicApiKey: data.ANTHROPIC_API_KEY,
    accessKey: data.ACCESS_KEY,
    upstashUrl,
    upstashToken,
    ...(localidad !== undefined && localidad.length > 0 ? { sourcingLocalidad: localidad } : {}),
  };
}
