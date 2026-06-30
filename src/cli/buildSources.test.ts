// Tests de buildSources: arma la lista de fuentes según la configuración.

import { describe, it, expect } from "vitest";
import type { Env } from "../config/env.js";
import { buildSources } from "./buildSources.js";

const BASE_ENV: Env = { anthropicApiKey: "sk-test" };

describe("buildSources", () => {
  it("incluye siempre la fuente web_search", () => {
    // Act
    const sources = buildSources(BASE_ENV);

    // Assert
    expect(sources.map((source) => source.id)).toContain("web-search");
  });

  it("agrega MercadoLibre cuando hay credenciales", () => {
    // Act
    const sources = buildSources({
      ...BASE_ENV,
      mercadoLibre: { clientId: "id", clientSecret: "secret" },
    });

    // Assert
    expect(sources.map((source) => source.id)).toEqual(["web-search", "mercado-libre"]);
  });

  it("no agrega MercadoLibre cuando no hay credenciales", () => {
    // Act
    const sources = buildSources(BASE_ENV);

    // Assert
    expect(sources.map((source) => source.id)).not.toContain("mercado-libre");
  });
});
