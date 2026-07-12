import { describe, it, expect } from "vitest";
import { createRedisStore, type RedisLike } from "./redisStore.js";
import type { Supplier } from "../domain/supplier.js";
import type { PublicSupplier } from "./publicDirectory.js";

const NOW = "2026-07-01T00:00:00.000Z";

function makeSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    name: "Aceros",
    material: "lámina",
    region: "mx",
    trusted: true,
    contact: {},
    status: "pendiente",
    firstSeen: NOW,
    lastSeen: NOW,
    ...overrides,
  };
}

/** Redis en memoria para el test (implementa RedisLike). */
function fakeRedis(seed: Record<string, string> = {}): RedisLike & { data: Record<string, string> } {
  const data: Record<string, string> = { ...seed };
  return {
    data,
    async get(key: string) {
      return key in data ? data[key] : null;
    },
    async set(key: string, value: string) {
      data[key] = value;
    },
  };
}

describe("redisStore", () => {
  it("loadDirectory devuelve [] cuando la clave no existe", async () => {
    const store = createRedisStore(fakeRedis());
    expect(await store.loadDirectory("x")).toEqual([]);
  });

  it("hace round-trip save → load del directorio", async () => {
    const redis = fakeRedis();
    const store = createRedisStore(redis);
    const suppliers = [makeSupplier({ name: "Uno" }), makeSupplier({ name: "Dos" })];
    await store.saveDirectory("x", suppliers);
    expect(await store.loadDirectory("x")).toEqual(suppliers);
  });

  it("valida con zod y migra un supplier sin status a 'pendiente'", async () => {
    const legacy = JSON.stringify([
      { name: "Viejo", material: "m", region: "mx", trusted: false, contact: {}, firstSeen: NOW, lastSeen: NOW },
    ]);
    const store = createRedisStore(fakeRedis({ directorio: legacy }));
    const loaded = await store.loadDirectory("x");
    expect(loaded[0]?.status).toBe("pendiente");
  });

  it("lanza error explícito si el JSON está corrupto", async () => {
    const store = createRedisStore(fakeRedis({ directorio: "no-es-json{" }));
    await expect(store.loadDirectory("x")).rejects.toThrow();
  });

  it("hace round-trip del directorio público", async () => {
    const redis = fakeRedis();
    const store = createRedisStore(redis);
    const publicos: PublicSupplier[] = [
      { name: "Pub", material: "m", region: "mx", contact: {}, trusted: true, status: "contactado" },
    ];
    await store.savePublicDirectory(publicos);
    expect(await store.loadPublicDirectory()).toEqual(publicos);
  });

  it("loadPublicDirectory devuelve [] cuando no hay nada publicado", async () => {
    const store = createRedisStore(fakeRedis());
    expect(await store.loadPublicDirectory()).toEqual([]);
  });
});
