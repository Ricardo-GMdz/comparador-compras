// Smoke E2E: levanta el server HTTP REAL (buildApi + @hono/node-server en
// puerto efímero) con la fuente mockeada y un directorio temporal, y ejercita
// el ciclo completo: buscar → patch → listar → csv → delete. Solo se sirve la
// API (sin estáticos): el HTML se valida manualmente en la Task 8.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { buildApi } from "./api.js";
import { loadDirectory, saveDirectory } from "../directory/store.js";
import type { SupplierSource } from "../sourcing/supplierSource.js";
import type { Supplier } from "../domain/supplier.js";

// Key derivada del dominio del candidato mockeado (ver supplierKey en store.ts).
const SUPPLIER_KEY = "d:acerosnorte.mx";

// Forma laxa de las respuestas JSON para las aserciones del test.
interface ApiBody {
  ok?: boolean;
  suppliers?: readonly Supplier[];
  mejorOpcion?: { name: string } | null;
  nuevos?: number;
  error?: string;
}

/** Fuente mockeada: un candidato fijo, sin llamadas de red. */
const fakeSource: SupplierSource = {
  search: vi.fn(async () => [
    {
      name: "Aceros del Norte",
      website: "https://acerosnorte.mx",
      material: "lámina galvanizada",
      region: "mx",
      trusted: true,
      contact: { whatsapp: "+52 81 1234 5678" },
      wholesalePrice: 180,
      priceUnit: "pieza" as const,
      currency: "MXN",
    },
  ]),
  enrichContact: vi.fn(async () => ({})),
};

describe("smoke E2E del server de sourcing", () => {
  let server: ServerType;
  let baseUrl: string;
  let tempDir: string;

  beforeAll(async () => {
    // Directorio temporal aislado: el store real lee/escribe acá.
    tempDir = await mkdtemp(join(tmpdir(), "comparador-e2e-"));
    const app = buildApi({
      source: fakeSource,
      loadDirectory,
      saveDirectory,
      savePublicDirectory: vi.fn(async () => {}),
      now: () => new Date().toISOString(),
      directoryPath: join(tempDir, "directorio.json"),
    });
    // Puerto 0 = efímero: el SO asigna uno libre y lo leemos del callback.
    baseUrl = await new Promise<string>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
        resolve(`http://127.0.0.1:${String(info.port)}`);
      });
    });
  });

  afterAll(async () => {
    // Cerrar el server explícitamente y limpiar el directorio temporal.
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
    await rm(tempDir, { recursive: true, force: true });
  });

  it("cubre buscar → patch → directorio → csv → delete sobre HTTP real", async () => {
    // 1) POST /api/buscar: el sourcing mockeado crea el proveedor y lo persiste.
    const buscarRes = await fetch(`${baseUrl}/api/buscar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "lámina galvanizada", region: "mx" }),
    });
    expect(buscarRes.status).toBe(200);
    const buscarBody = (await buscarRes.json()) as ApiBody;
    expect(buscarBody.ok).toBe(true);
    expect(buscarBody.nuevos).toBe(1);
    expect(buscarBody.mejorOpcion?.name).toBe("Aceros del Norte");

    // 2) PATCH /api/proveedor/:key: cambia estado y notas.
    const patchRes = await fetch(`${baseUrl}/api/proveedor/${encodeURIComponent(SUPPLIER_KEY)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "contactado", notes: "cotización pedida por WhatsApp" }),
    });
    expect(patchRes.status).toBe(200);
    expect(((await patchRes.json()) as ApiBody).ok).toBe(true);

    // 3) GET /api/directorio: refleja el cambio persistido en disco.
    const dirRes = await fetch(`${baseUrl}/api/directorio`);
    expect(dirRes.status).toBe(200);
    const dirBody = (await dirRes.json()) as ApiBody;
    expect(dirBody.suppliers).toHaveLength(1);
    expect(dirBody.suppliers?.[0]?.status).toBe("contactado");
    expect(dirBody.suppliers?.[0]?.notes).toBe("cotización pedida por WhatsApp");

    // 4) GET /api/directorio.csv: el proveedor aparece en el export.
    const csvRes = await fetch(`${baseUrl}/api/directorio.csv`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("content-type")).toContain("text/csv");
    const csv = await csvRes.text();
    expect(csv).toContain("Aceros del Norte");
    expect(csv).toContain("contactado");

    // 5) DELETE /api/proveedor/:key: lo elimina y el directorio queda vacío.
    const deleteRes = await fetch(`${baseUrl}/api/proveedor/${encodeURIComponent(SUPPLIER_KEY)}`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);
    expect(((await deleteRes.json()) as ApiBody).ok).toBe(true);

    const finalRes = await fetch(`${baseUrl}/api/directorio`);
    const finalBody = (await finalRes.json()) as ApiBody;
    expect(finalBody.suppliers).toHaveLength(0);
  });
});
