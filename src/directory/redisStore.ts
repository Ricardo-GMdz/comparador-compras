// Store del directorio respaldado por Redis (Upstash). Implementa el mismo
// contrato que el store de archivo, reusando la validación zod. La identidad
// de la clave no depende del `path` (se conserva la firma por compatibilidad).

import { directorySchema } from "./store.js";
import type { Supplier } from "../domain/supplier.js";
import type { PublicSupplier } from "./publicDirectory.js";

/** Interfaz mínima de Redis que necesitamos (inyectable para tests). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

// Claves fijas en Redis. El directorio privado y el público viven separados.
const DIRECTORY_KEY = "directorio";
const PUBLIC_KEY = "directorio-publico";

/** Crea un store del directorio sobre un cliente Redis. */
export function createRedisStore(redis: RedisLike) {
  async function loadDirectory(_path: string): Promise<readonly Supplier[]> {
    const raw = await redis.get(DIRECTORY_KEY);
    if (raw === null) {
      return [];
    }
    // Validamos con el MISMO schema que el store de archivo (dato externo).
    return directorySchema.parse(JSON.parse(raw));
  }

  async function saveDirectory(_path: string, suppliers: readonly Supplier[]): Promise<void> {
    await redis.set(DIRECTORY_KEY, JSON.stringify(suppliers));
  }

  async function loadPublicDirectory(): Promise<readonly PublicSupplier[]> {
    const raw = await redis.get(PUBLIC_KEY);
    if (raw === null) {
      return [];
    }
    // El público lo escribe siempre esta misma app (regenerado desde el
    // directorio privado ya validado): no re-validamos con zod acá.
    return JSON.parse(raw) as PublicSupplier[];
  }

  async function savePublicDirectory(suppliers: readonly PublicSupplier[]): Promise<void> {
    await redis.set(PUBLIC_KEY, JSON.stringify(suppliers));
  }

  return { loadDirectory, saveDirectory, loadPublicDirectory, savePublicDirectory };
}
