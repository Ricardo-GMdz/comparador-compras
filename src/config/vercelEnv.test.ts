import { describe, it, expect } from "vitest";
import { loadVercelEnv } from "./vercelEnv.js";

const BASE = {
  ANTHROPIC_API_KEY: "sk-test",
  ACCESS_KEY: "clave",
  UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "tok",
};

describe("loadVercelEnv", () => {
  it("devuelve el env validado con todos los campos", () => {
    const env = loadVercelEnv({ ...BASE, SOURCING_LOCALIDAD: "Monterrey" });
    expect(env).toEqual({
      anthropicApiKey: "sk-test",
      accessKey: "clave",
      upstashUrl: "https://x.upstash.io",
      upstashToken: "tok",
      sourcingLocalidad: "Monterrey",
    });
  });

  it("localidad es opcional", () => {
    const env = loadVercelEnv(BASE);
    expect(env.sourcingLocalidad).toBeUndefined();
  });

  it("falla con mensaje claro si falta ACCESS_KEY", () => {
    const { ACCESS_KEY: _omit, ...sinClave } = BASE;
    expect(() => loadVercelEnv(sinClave)).toThrow(/ACCESS_KEY/);
  });
});
