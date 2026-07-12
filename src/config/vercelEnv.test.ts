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

  it("acepta los nombres KV_* que inyecta la integración de Upstash en Vercel", () => {
    const env = loadVercelEnv({
      ANTHROPIC_API_KEY: "sk-test",
      ACCESS_KEY: "clave",
      KV_REST_API_URL: "https://kv.upstash.io",
      KV_REST_API_TOKEN: "kv-tok",
    });
    expect(env.upstashUrl).toBe("https://kv.upstash.io");
    expect(env.upstashToken).toBe("kv-tok");
  });

  it("los nombres UPSTASH_* tienen prioridad sobre los KV_*", () => {
    const env = loadVercelEnv({
      ANTHROPIC_API_KEY: "sk-test",
      ACCESS_KEY: "clave",
      UPSTASH_REDIS_REST_URL: "https://upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "up-tok",
      KV_REST_API_URL: "https://kv.upstash.io",
      KV_REST_API_TOKEN: "kv-tok",
    });
    expect(env.upstashUrl).toBe("https://upstash.io");
    expect(env.upstashToken).toBe("up-tok");
  });

  it("falla con mensaje claro si no hay URL/token de Redis en ningún esquema", () => {
    const { UPSTASH_REDIS_REST_URL: _u, UPSTASH_REDIS_REST_TOKEN: _t, ...sinRedis } = BASE;
    expect(() => loadVercelEnv(sinRedis)).toThrow(/Redis/);
  });
});
