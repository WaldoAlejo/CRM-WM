// @vitest-environment node
//
// Entorno "node" a propósito (no happy-dom): esto es una prueba de red real
// contra un servidor http real, y happy-dom emula política de mismo origen
// (CORS) sobre su fetch — bloquearía cualquier request cross-origin a un
// server de Node plano que no manda headers CORS, sin que eso tenga nada que
// ver con lo que este test quiere probar (el parseo de body vacío/inválido).
//
// Verifica el punto pedido explícitamente: apiFetch no debe reventar en
// res.json() cuando el body viene vacío (204, o cualquier respuesta sin
// contenido). Usa un servidor HTTP real (Node "http", no fetch mockeado) —
// una respuesta real, de un endpoint real, no una simulación de fetch.
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiFetch, ApiError, setApiBaseUrl, setToken } from "./api";

// Entorno "node" puro (ver arriba): no trae localStorage global como el
// navegador/happy-dom. apiFetch lo necesita para leer el token — un stub
// mínimo en memoria alcanza, no estamos probando persistencia acá. Solo
// accede a localStorage DENTRO de las funciones de api.ts (nunca al importar
// el módulo), así que da igual que este stub se instale después del import.
const memoryStore = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => memoryStore.get(key) ?? null,
  setItem: (key: string, value: string) => void memoryStore.set(key, value),
  removeItem: (key: string) => void memoryStore.delete(key),
  clear: () => memoryStore.clear(),
  key: (index: number) => Array.from(memoryStore.keys())[index] ?? null,
  get length() {
    return memoryStore.size;
  },
} satisfies Storage;

describe("apiFetch — respuestas sin body", () => {
  let server: Server;
  let baseUrl: string;
  let lastMethod: string | undefined;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      lastMethod = req.method;
      if (req.url === "/things/1" && req.method === "DELETE") {
        res.writeHead(204);
        res.end(); // sin body, exactamente como el backend real en un soft delete
        return;
      }
      if (req.url === "/things/no-content-length" && req.method === "GET") {
        // 200 con body vacío, sin Content-Length explícito — otro caso real
        // de "no hay nada que parsear" que no depende del código de status.
        res.writeHead(200);
        res.end();
        return;
      }
      if (req.url === "/things/broken-json" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("esto no es json");
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No encontrado" }));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    setApiBaseUrl(baseUrl);
    setToken("fake-token-para-el-test");
  });

  afterAll(() => {
    server.close();
  });

  it("DELETE con 204 real: no crashea en res.json(), devuelve undefined", async () => {
    const result = await apiFetch<void>("/things/1", { method: "DELETE" });
    expect(result).toBeUndefined();
    expect(lastMethod).toBe("DELETE");
  });

  it("200 con body vacío (sin Content-Length): también devuelve undefined, no lanza SyntaxError", async () => {
    const result = await apiFetch<void>("/things/no-content-length");
    expect(result).toBeUndefined();
  });

  it("body no vacío pero JSON inválido: lanza ApiError con mensaje claro, no un SyntaxError críptico", async () => {
    await expect(apiFetch("/things/broken-json")).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).message).toMatch(/Respuesta no válida/);
      return true;
    });
  });

  it("sigue parseando JSON normal cuando SÍ hay body (caso 404 con { error })", async () => {
    await expect(apiFetch("/things/inexistente")).rejects.toMatchObject({
      message: "No encontrado",
      status: 404,
    });
  });
});
