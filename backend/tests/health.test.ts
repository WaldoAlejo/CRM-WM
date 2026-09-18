import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
// OJO: /health usa el prisma singleton de src/lib/prisma (el de la app), NO
// el cliente de tests/helpers.ts (que apunta a DIRECT_URL para los tests) —
// hay que espiar la instancia correcta o el mock no tiene ningún efecto.
import { prisma as appPrisma } from "../src/lib/prisma";

describe("GET /health", () => {
  it("200 { status: 'ok', db: 'connected' } cuando la base responde", async () => {
    const app = createApp();
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", db: "connected" });
  });

  it("503 { status: 'error', db: 'disconnected' } si la query a la base falla", async () => {
    const app = createApp();
    const spy = vi.spyOn(appPrisma, "$queryRaw").mockRejectedValueOnce(new Error("conexión caída"));

    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "error", db: "disconnected" });

    spy.mockRestore();
  });
});

describe("CORS", () => {
  const originalCorsOrigin = process.env.CORS_ORIGIN;

  afterEach(() => {
    if (originalCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = originalCorsOrigin;
  });

  it("sin CORS_ORIGIN: refleja cualquier Origin (comportamiento abierto de desarrollo)", async () => {
    delete process.env.CORS_ORIGIN;
    const app = createApp();

    const res = await request(app).get("/health").set("Origin", "https://cualquier-sitio.com");

    expect(res.headers["access-control-allow-origin"]).toBe("https://cualquier-sitio.com");
  });

  it("con CORS_ORIGIN seteada: permite un origen de la lista", async () => {
    process.env.CORS_ORIGIN = "https://app.kestore.com,https://admin.kestore.com";
    const app = createApp();

    const res = await request(app).get("/health").set("Origin", "https://admin.kestore.com");

    expect(res.headers["access-control-allow-origin"]).toBe("https://admin.kestore.com");
  });

  it("con CORS_ORIGIN seteada: NO refleja un origen fuera de la lista", async () => {
    process.env.CORS_ORIGIN = "https://app.kestore.com";
    const app = createApp();

    const res = await request(app).get("/health").set("Origin", "https://sitio-no-autorizado.com");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
