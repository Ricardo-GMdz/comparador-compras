import { describe, it, expect, vi } from "vitest";
import { buildApi } from "./api.js";
import type { Supplier } from "../domain/supplier.js";
import type { PublicSupplier } from "../directory/publicDirectory.js";

// Forma laxa de la respuesta JSON de la API para las aserciones del test.
interface ApiBody {
  ok?: boolean;
  suppliers?: readonly Supplier[];
  mejorOpcion?: { name: string } | null;
  nuevos?: number;
  total?: number;
  error?: string;
  message?: string;
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
  const published: { current: readonly PublicSupplier[] | undefined } = { current: undefined };
  return {
    store,
    published,
    deps: {
      savePublicDirectory: vi.fn(async (suppliers: readonly PublicSupplier[]) => {
        published.current = suppliers;
      }),
      loadPublicDirectory: vi.fn(async () => published.current ?? []),
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
        enrichContact: vi.fn(async () => ({})),
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
      makeSupplier({ name: "B", website: "https://b.mx", address: "Monterrey, NL" }),
    ]);
    const app = buildApi(deps);
    const res = await app.request("/api/directorio.csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    const lines = text.split("\n");
    // Header + una fila por proveedor.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Proveedor");
    expect(lines[0]).toContain("Estado");
    expect(text).toContain("Aceros");
    expect(text).toContain('"Monterrey, NL"');
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

  it("POST /api/proveedor/:key/enriquecer mergea el contacto nuevo sin pisar el existente", async () => {
    // Arrange: el proveedor ya tiene email; la fuente devuelve email y phone nuevos.
    const { deps, store } = fakeDeps([
      makeSupplier({ website: "https://a.mx", contact: { email: "ya@a.mx" } }),
    ]);
    deps.source.enrichContact = vi.fn(async () => ({
      email: "nuevo@a.mx",
      phone: "+52 55 1234",
    }));
    const app = buildApi(deps);

    // Act
    const res = await app.request(`/api/proveedor/${encodeURIComponent("d:a.mx")}/enriquecer`, {
      method: "POST",
    });

    // Assert: el email existente gana; el phone se agrega; se persiste.
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiBody;
    expect(body.ok).toBe(true);
    expect(deps.saveDirectory).toHaveBeenCalledOnce();
    expect(store.current[0]?.contact).toEqual({ email: "ya@a.mx", phone: "+52 55 1234" });
  });

  it("POST /api/proveedor/:key/enriquecer responde 404 con key inexistente", async () => {
    const { deps } = fakeDeps([makeSupplier({ website: "https://a.mx" })]);
    const app = buildApi(deps);
    const res = await app.request(
      `/api/proveedor/${encodeURIComponent("d:no-existe.mx")}/enriquecer`,
      { method: "POST" },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiBody;
    expect(body.ok).toBe(false);
    expect(deps.source.enrichContact).not.toHaveBeenCalled();
  });

  it("POST /api/proveedor/:key/enriquecer responde 502 si la fuente lanza", async () => {
    const { deps, store } = fakeDeps([makeSupplier({ website: "https://a.mx" })]);
    deps.source.enrichContact = vi.fn(async () => {
      throw new Error("web_fetch caído");
    });
    const app = buildApi(deps);
    const res = await app.request(`/api/proveedor/${encodeURIComponent("d:a.mx")}/enriquecer`, {
      method: "POST",
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as ApiBody;
    expect(body.ok).toBe(false);
    // No se persiste nada si el enriquecimiento falló.
    expect(deps.saveDirectory).not.toHaveBeenCalled();
    expect(store.current[0]?.contact).toEqual({});
  });

  it("GET /api/proveedor/:key/cotizacion devuelve el mensaje de cotización", async () => {
    const { deps } = fakeDeps([
      makeSupplier({ name: "Aceros MX", website: "https://a.mx", material: "lámina" }),
    ]);
    const app = buildApi(deps);
    const res = await app.request(
      `/api/proveedor/${encodeURIComponent("d:a.mx")}/cotizacion?quantity=${encodeURIComponent("500 piezas")}&spec=${encodeURIComponent("lámina galvanizada cal. 26")}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiBody;
    expect(body.ok).toBe(true);
    // El mensaje sale del template local con los datos del proveedor y la query.
    expect(body.message).toContain("Aceros MX");
    expect(body.message).toContain("500 piezas");
    expect(body.message).toContain("lámina galvanizada cal. 26");
    expect(body.message).not.toContain("undefined");
  });

  it("GET /api/proveedor/:key/cotizacion responde 404 con key inexistente", async () => {
    const { deps } = fakeDeps([makeSupplier({ website: "https://a.mx" })]);
    const app = buildApi(deps);
    const res = await app.request(
      `/api/proveedor/${encodeURIComponent("d:no-existe.mx")}/cotizacion?quantity=1&spec=x`,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiBody;
    expect(body.ok).toBe(false);
  });

  it("GET /api/proveedor/:key/cotizacion responde 400 si falta quantity o spec", async () => {
    const { deps } = fakeDeps([makeSupplier({ website: "https://a.mx" })]);
    const app = buildApi(deps);
    const sinQuantity = await app.request(
      `/api/proveedor/${encodeURIComponent("d:a.mx")}/cotizacion?spec=x`,
    );
    expect(sinQuantity.status).toBe(400);
    const sinSpec = await app.request(
      `/api/proveedor/${encodeURIComponent("d:a.mx")}/cotizacion?quantity=1`,
    );
    expect(sinSpec.status).toBe(400);
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

  it("POST /api/buscar calcula mejorOpcion SOLO entre lo hallado en esta búsqueda (no cruza rubros)", async () => {
    // Arrange: en el directorio ya vive un proveedor de OTRO rubro, confiable y
    // más barato. La búsqueda actual encuentra a "Aceros" (fake source). La
    // mejor opción debe ser de esta búsqueda, no el barato de otro rubro.
    const { deps } = fakeDeps([
      makeSupplier({
        name: "Láminas Baratas (otro rubro)",
        website: "https://laminas.mx",
        wholesalePrice: 5,
        trusted: true,
      }),
    ]);
    const app = buildApi(deps);

    // Act
    const res = await app.request("/api/buscar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "dinamómetro", region: "mx" }),
    });

    // Assert: el directorio completo se lista, pero el best es del rubro buscado.
    const body = (await res.json()) as ApiBody;
    expect(body.suppliers?.map((s) => s.name)).toContain("Láminas Baratas (otro rubro)");
    expect(body.mejorOpcion?.name).toBe("Aceros");
  });

  it("POST /api/publicar escribe el directorio público (solo contactados/cotizó, sin notas)", async () => {
    // Arrange: uno publicable con notas privadas y uno pendiente.
    const { deps, published } = fakeDeps([
      makeSupplier({
        name: "PYLSA",
        website: "https://pylsa.com",
        status: "cotizó",
        notes: "margen 12% (privado)",
      }),
      makeSupplier({ name: "Pendiente", website: "https://p.mx", status: "pendiente" }),
    ]);
    const app = buildApi(deps);

    // Act
    const res = await app.request("/api/publicar", { method: "POST" });

    // Assert
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiBody & { publicados?: number };
    expect(body.ok).toBe(true);
    expect(body.publicados).toBe(1);
    expect(published.current?.map((s) => s.name)).toEqual(["PYLSA"]);
    expect(published.current?.[0]).not.toHaveProperty("notes");
  });

  it("POST /api/publicar responde 500 con envelope si la escritura falla", async () => {
    // Arrange
    const { deps } = fakeDeps([makeSupplier({ status: "contactado" })]);
    deps.savePublicDirectory = vi.fn(async () => {
      throw new Error("disco lleno");
    });
    const app = buildApi(deps);

    // Act
    const res = await app.request("/api/publicar", { method: "POST" });

    // Assert
    expect(res.status).toBe(500);
    const body = (await res.json()) as ApiBody;
    expect(body.ok).toBe(false);
  });
});

describe("v2.3: /api/buscar devuelve los encontrados", () => {
  it("incluye 'encontrados' con los proveedores hallados en esa búsqueda", async () => {
    const { deps } = fakeDeps();
    const app = buildApi(deps);
    const res = await app.request("/api/buscar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "lámina", region: "mx" }),
    });
    const data = (await res.json()) as { ok: boolean; encontrados?: Array<{ name: string }> };
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.encontrados)).toBe(true);
    expect(data.encontrados?.some((s) => s.name === "Aceros")).toBe(true);
  });
});

describe("v2.2: PATCH favorite y CSV", () => {
  it("PATCH { favorite: true } persiste en el directorio", async () => {
    const { deps, store } = fakeDeps([
      {
        name: "X",
        website: "https://x.mx",
        material: "m",
        region: "mx",
        trusted: true,
        contact: {},
        status: "pendiente",
        firstSeen: "2026-07-01T00:00:00.000Z",
        lastSeen: "2026-07-01T00:00:00.000Z",
      },
    ]);
    const app = buildApi(deps);
    const res = await app.request("/api/proveedor/d%3Ax.mx", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorite: true }),
    });
    expect(res.status).toBe(200);
    expect(store.current[0]?.favorite).toBe(true);
  });

  it("el CSV usa encabezados en español y el precio de catálogo como Precio", async () => {
    const { deps } = fakeDeps([
      {
        name: "X",
        material: "m",
        region: "mx",
        trusted: true,
        contact: {},
        status: "pendiente",
        catalogPrice: 439.99,
        address: "Monterrey",
        favorite: true,
        firstSeen: "2026-07-01T00:00:00.000Z",
        lastSeen: "2026-07-01T00:00:00.000Z",
      },
    ]);
    const app = buildApi(deps);
    const res = await app.request("/api/directorio.csv");
    const text = await res.text();
    const header = text.split("\n")[0];
    expect(header).toContain("Dirección");
    expect(header).toContain("Favorito");
    expect(header).not.toContain("catalogPrice");
    expect(text).toContain("439.99");
    expect(text).toContain("Monterrey");
  });
});

describe("v2.3: CSV resumido en español", () => {
  it("exporta 12 encabezados en español y sin columnas internas", async () => {
    const { deps } = fakeDeps([
      {
        name: "X",
        material: "m",
        region: "mx",
        trusted: true,
        contact: {},
        status: "pendiente",
        firstSeen: "2026-07-01T00:00:00.000Z",
        lastSeen: "2026-07-01T00:00:00.000Z",
      },
    ]);
    const app = buildApi(deps);
    const res = await app.request("/api/directorio.csv");
    const header = (await res.text()).split("\n")[0];
    expect(header).toBe(
      "Proveedor,Sitio web,Material,Región,Precio,Moneda,Email,WhatsApp,Teléfono,Dirección,Estado,Favorito",
    );
    expect(header).not.toContain("firstSeen");
    expect(header).not.toContain("notes");
    expect(header).not.toContain("trusted");
  });

  it("Precio usa mayoreo si hay, si no catálogo; Favorito 'sí'; Moneda en su columna", async () => {
    const { deps } = fakeDeps([
      {
        name: "Con mayoreo",
        material: "m",
        region: "mx",
        trusted: true,
        contact: { email: "a@a.mx", whatsapp: "+52 81 1234 5678" },
        status: "contactado",
        wholesalePrice: 180,
        currency: "MXN",
        favorite: true,
        firstSeen: "2026-07-01T00:00:00.000Z",
        lastSeen: "2026-07-01T00:00:00.000Z",
      },
      {
        name: "Solo catálogo",
        material: "m",
        region: "mx",
        trusted: true,
        contact: {},
        status: "pendiente",
        catalogPrice: 439.99,
        currency: "USD",
        firstSeen: "2026-07-01T00:00:00.000Z",
        lastSeen: "2026-07-01T00:00:00.000Z",
      },
    ]);
    const app = buildApi(deps);
    const lines = (await (await app.request("/api/directorio.csv")).text()).split("\n");
    expect(lines[1]).toContain("180");
    expect(lines[1]).toContain("MXN");
    expect(lines[1]).toContain("sí");
    expect(lines[2]).toContain("439.99");
    expect(lines[2]).toContain("USD");
  });
});

describe("API — auth y público", () => {
  const NOW_MS = 5_000_000;

  it("sin cookie, una ruta protegida responde 401", async () => {
    const { deps } = fakeDeps();
    const app = buildApi({ ...deps, auth: { accessKey: "secreta", now: () => NOW_MS } });
    const res = await app.request("/api/directorio");
    expect(res.status).toBe(401);
  });

  it("login con clave correcta setea cookie y habilita el acceso", async () => {
    const { deps } = fakeDeps();
    const app = buildApi({ ...deps, auth: { accessKey: "secreta", now: () => NOW_MS } });

    const login = await app.request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "secreta" }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("cc_auth=");

    const jar = cookie.split(";")[0];
    const ok = await app.request("/api/directorio", { headers: { cookie: jar } });
    expect(ok.status).toBe(200);
  });

  it("login con clave incorrecta responde 401 sin cookie", async () => {
    const { deps } = fakeDeps();
    const app = buildApi({ ...deps, auth: { accessKey: "secreta", now: () => NOW_MS } });
    const res = await app.request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "incorrecta" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("GET /api/publico responde sin clave, con CORS, y solo campos públicos", async () => {
    const { deps } = fakeDeps();
    deps.loadPublicDirectory = vi.fn(async () => [
      {
        name: "Pub",
        material: "m",
        region: "mx",
        contact: {},
        trusted: true,
        status: "contactado",
      },
    ]);
    const app = buildApi({ ...deps, auth: { accessKey: "secreta", now: () => NOW_MS } });
    const res = await app.request("/api/publico");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body[0]?.name).toBe("Pub");
    expect(body[0]).not.toHaveProperty("notes");
  });

  it("no se evade la clave con el path percent-encodeado", async () => {
    const { deps } = fakeDeps();
    const app = buildApi({ ...deps, auth: { accessKey: "secreta", now: () => NOW_MS } });
    const res = await app.request("/%61pi/directorio"); // %61 = "a"
    expect(res.status).toBe(401);
  });

  it("sin auth (entry local) las rutas no exigen cookie", async () => {
    const { deps } = fakeDeps();
    const app = buildApi(deps); // sin `auth`
    const res = await app.request("/api/directorio");
    expect(res.status).toBe(200);
  });
});

describe("API — healthcheck público", () => {
  it("GET /api/health responde 200 { ok:true, status:'ok' } sin clave (aun con auth)", async () => {
    const { deps } = fakeDeps();
    const app = buildApi({ ...deps, auth: { accessKey: "secreta", now: () => 5_000_000 } });
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; status?: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("ok");
  });

  it("no depende del directorio (no llama loadDirectory)", async () => {
    const { deps } = fakeDeps();
    const app = buildApi(deps);
    await app.request("/api/health");
    expect(deps.loadDirectory).not.toHaveBeenCalled();
  });
});
