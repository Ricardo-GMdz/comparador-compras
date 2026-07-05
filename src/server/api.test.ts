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

/** Proveedor base para armar fixtures sin repetir campos obligatorios. */
function makeSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    name: "X",
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

  it("PATCH /api/proveedor/:key cambia status y notes y persiste", async () => {
    const { deps, store } = fakeDeps([makeSupplier({ website: "https://a.mx" })]);
    const app = buildApi(deps);
    const res = await app.request(`/api/proveedor/${encodeURIComponent("d:a.mx")}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "contactado", notes: "llamar el lunes" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiBody;
    expect(body.ok).toBe(true);
    expect(deps.saveDirectory).toHaveBeenCalledOnce();
    expect(store.current[0]?.status).toBe("contactado");
    expect(store.current[0]?.notes).toBe("llamar el lunes");
  });

  it("PATCH /api/proveedor/:key responde 404 con key inexistente", async () => {
    const { deps } = fakeDeps([makeSupplier({ website: "https://a.mx" })]);
    const app = buildApi(deps);
    const res = await app.request(`/api/proveedor/${encodeURIComponent("d:no-existe.mx")}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "contactado" }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiBody;
    expect(body.ok).toBe(false);
  });

  it("PATCH /api/proveedor/:key responde 400 con body inválido", async () => {
    const { deps } = fakeDeps([makeSupplier({ website: "https://a.mx" })]);
    const app = buildApi(deps);
    // Status fuera del enum.
    const resEnum = await app.request(`/api/proveedor/${encodeURIComponent("d:a.mx")}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "inventado" }),
    });
    expect(resEnum.status).toBe(400);
    // Body sin ningún campo (se exige al menos uno).
    const resVacio = await app.request(`/api/proveedor/${encodeURIComponent("d:a.mx")}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(resVacio.status).toBe(400);
  });

  it("DELETE /api/proveedor/:key elimina y persiste", async () => {
    const { deps, store } = fakeDeps([
      makeSupplier({ name: "A", website: "https://a.mx" }),
      makeSupplier({ name: "B", website: "https://b.mx" }),
    ]);
    const app = buildApi(deps);
    const res = await app.request(`/api/proveedor/${encodeURIComponent("d:a.mx")}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiBody;
    expect(body.ok).toBe(true);
    expect(deps.saveDirectory).toHaveBeenCalledOnce();
    expect(store.current).toHaveLength(1);
    expect(store.current[0]?.name).toBe("B");
  });

  it("DELETE /api/proveedor/:key responde 404 si no existe", async () => {
    const { deps, store } = fakeDeps([makeSupplier({ website: "https://a.mx" })]);
    const app = buildApi(deps);
    const res = await app.request(`/api/proveedor/${encodeURIComponent("d:no-existe.mx")}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiBody;
    expect(body.ok).toBe(false);
    expect(store.current).toHaveLength(1);
  });

  it("GET /api/directorio.csv devuelve text/csv con header y una fila por proveedor", async () => {
    const { deps } = fakeDeps([
      makeSupplier({ name: "Aceros", website: "https://a.mx", wholesalePrice: 180 }),
      // Campo con coma: debe salir entre comillas en el CSV.
      makeSupplier({ name: "B", website: "https://b.mx", notes: "ojo, es caro" }),
    ]);
    const app = buildApi(deps);
    const res = await app.request("/api/directorio.csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    const lines = text.split("\n");
    // Header + una fila por proveedor.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("name");
    expect(lines[0]).toContain("status");
    expect(text).toContain("Aceros");
    expect(text).toContain('"ojo, es caro"');
  });

  it("GET /api/directorio incluye a los descartados en suppliers", async () => {
    const { deps } = fakeDeps([
      makeSupplier({ name: "Descartado", website: "https://d.mx", status: "descartado" }),
      makeSupplier({ name: "Activo", website: "https://a.mx" }),
    ]);
    const app = buildApi(deps);
    const res = await app.request("/api/directorio");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiBody;
    expect(body.suppliers?.map((s) => s.name)).toContain("Descartado");
  });

  it("POST /api/buscar nunca elige un descartado como mejorOpcion", async () => {
    // El descartado es más barato y confiable: aun así no puede ganar.
    const { deps } = fakeDeps([
      makeSupplier({
        name: "Descartado",
        website: "https://d.mx",
        wholesalePrice: 10,
        status: "descartado",
      }),
    ]);
    const app = buildApi(deps);
    const res = await app.request("/api/buscar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "lámina", region: "mx" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiBody;
    // Sigue apareciendo en la lista, pero no como mejor opción.
    expect(body.suppliers?.map((s) => s.name)).toContain("Descartado");
    expect(body.mejorOpcion?.name).toBe("Aceros");
  });
});
