import { describe, it, expect, vi } from "vitest";
import { buildApi } from "./api.js";
import type { Supplier } from "../domain/supplier.js";

// Forma laxa de la respuesta JSON de la API para las aserciones del test.
interface ApiBody {
  ok?: boolean;
  suppliers?: readonly Supplier[];
  mejorOpcion?: { name: string } | null;
  nuevos?: number;
  total?: number;
  error?: string;
}

const NOW = "2026-07-01T00:00:00.000Z";
function fakeDeps(existing: Supplier[] = []) {
  const store = { current: existing as readonly Supplier[] };
  return {
    store,
    deps: {
      source: {
        search: vi.fn(async () => [
          {
            name: "Aceros",
            website: "https://a.mx",
            material: "lámina",
            region: "mx",
            trusted: true,
            contact: {},
            wholesalePrice: 180,
          },
        ]),
      },
      loadDirectory: vi.fn(async () => store.current),
      saveDirectory: vi.fn(async (_p: string, s: readonly Supplier[]) => {
        store.current = s;
      }),
      now: () => NOW,
      directoryPath: "/tmp/x.json",
    },
  };
}

describe("API", () => {
  it("GET /api/directorio devuelve el directorio actual", async () => {
    const { deps } = fakeDeps([
      {
        name: "X",
        material: "y",
        region: "mx",
        trusted: true,
        contact: {},
        status: "pendiente",
        firstSeen: NOW,
        lastSeen: NOW,
      },
    ]);
    const app = buildApi(deps);
    const res = await app.request("/api/directorio");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiBody;
    expect(body.suppliers).toHaveLength(1);
  });

  it("POST /api/buscar corre el sourcing, mergea y responde mejor opción + nuevos", async () => {
    const { deps } = fakeDeps();
    const app = buildApi(deps);
    const res = await app.request("/api/buscar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "lámina", region: "mx" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiBody;
    expect(body.nuevos).toBe(1);
    expect(body.mejorOpcion?.name).toBe("Aceros");
    expect(body.suppliers).toHaveLength(1);
  });

  it("POST /api/buscar valida el body (400 si falta query)", async () => {
    const { deps } = fakeDeps();
    const app = buildApi(deps);
    const res = await app.request("/api/buscar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ region: "mx" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/buscar responde 502 con envelope de error si el sourcing falla", async () => {
    const { deps } = fakeDeps();
    deps.source.search = vi.fn(async () => {
      throw new Error("web_search caído");
    });
    const app = buildApi(deps);
    const res = await app.request("/api/buscar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "lámina", region: "mx" }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as ApiBody;
    expect(body.ok).toBe(false);
  });
});
