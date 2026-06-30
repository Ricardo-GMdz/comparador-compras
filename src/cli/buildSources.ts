// Arma la lista de fuentes de productos a partir de la configuración validada.
// web_search está siempre; MercadoLibre se suma solo si hay credenciales.

import type { Env } from "../config/env.js";
import type { ProductSource } from "../domain/source.js";
import { createWebSearchSource } from "../sources/webSearchSource.js";
import { createMercadoLibreSource } from "../sources/mercadoLibreSource.js";

/** Construye las fuentes habilitadas según el entorno. */
export function buildSources(env: Env): readonly ProductSource[] {
  const sources: ProductSource[] = [createWebSearchSource({ apiKey: env.anthropicApiKey })];

  if (env.mercadoLibre !== undefined) {
    sources.push(
      createMercadoLibreSource({
        clientId: env.mercadoLibre.clientId,
        clientSecret: env.mercadoLibre.clientSecret,
      }),
    );
  }

  return sources;
}
