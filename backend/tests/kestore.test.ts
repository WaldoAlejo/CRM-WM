import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { pendingKestoreChanges, resetKestoreSyncBackoff, runKestoreSync } from "../src/jobs/kestoreSync";
import { isValidKestoreSignature, signKestorePayload } from "../src/modules/kestore/kestore.config";
import { createCategoryFixture, createProductFixture, createVariantFixture, createWholesalerFixture, prisma, resetDatabase } from "./helpers";

const app = createApp();
const SECRET = "s".repeat(40);
const BASE = "/api/integrations/kestore";

beforeEach(() => {
  vi.stubEnv("KESTORE_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("KESTORE_WEBHOOK_URL", "https://kestore.test/crm/webhook/stock");
  resetKestoreSyncBackoff();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await resetDatabase();
});

function signed(method: "get" | "post", path: string, body?: unknown) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const req = request(app)[method](`${BASE}${path}`)
    .set("X-Crm-Timestamp", timestamp)
    .set("X-Crm-Signature", signKestorePayload(SECRET, timestamp, raw));
  return body === undefined ? req : req.set("Content-Type", "application/json").send(raw);
}

async function perfume(options: { code?: string; stock?: number; reserved?: number; showOnKestore?: boolean; price?: number } = {}) {
  const { category } = await createCategoryFixture();
  const product = await createProductFixture({ categoryId: category.id });
  await prisma.product.update({ where: { id: product.id }, data: { name: "Yara 100mL EDP", showOnKestore: options.showOnKestore ?? true, ivaCode: "4", ivaRate: 15,
    images: { create: [{ url: "/uploads/products/yara.jpg", position: 0 }] } } });
  const variant = await createVariantFixture({ productId: product.id, stock: options.stock ?? 5, reservedStock: options.reserved ?? 0 });
  return prisma.productVariant.update({ where: { id: variant.id }, data: { kestoreCode: options.code ?? "FOUR032", wholesalePrice: options.price ?? 31.3, dimensionsCm: "10x7x14", weightKg: 0.5 } });
}

describe("firma de las peticiones de Kestore", () => {
  it("rechaza firmas inválidas o vencidas y valida la buena", () => {
    const body = Buffer.from('{"a":1}');
    const now = Date.now();
    const ts = String(Math.floor(now / 1000));
    expect(isValidKestoreSignature(SECRET, ts, signKestorePayload(SECRET, ts, body), body, now)).toBe(true);
    expect(isValidKestoreSignature(SECRET, ts, signKestorePayload("x".repeat(40), ts, body), body, now)).toBe(false);
    expect(isValidKestoreSignature(SECRET, ts, signKestorePayload(SECRET, ts, body), Buffer.from('{"a":2}'), now)).toBe(false);
    const old = String(Math.floor(now / 1000) - 301);
    expect(isValidKestoreSignature(SECRET, old, signKestorePayload(SECRET, old, body), body, now)).toBe(false);
  });

  it("responde 401 sin firma y 503 si la integración no está configurada", async () => {
    expect((await request(app).get(`${BASE}/catalog`)).status).toBe(401);
    vi.stubEnv("KESTORE_WEBHOOK_SECRET", "");
    expect((await signed("get", "/catalog")).status).toBe(503);
  });
});

describe("GET /catalog", () => {
  it("publica precio con IVA y stock disponible; lo no marcado para Kestore va inactivo", async () => {
    await perfume({ stock: 5, reserved: 2 });
    await perfume({ code: "PERKE999", showOnKestore: false });
    const res = await signed("get", "/catalog");
    expect(res.status).toBe(200);
    const [yara, hidden] = res.body.items;
    expect(yara).toMatchObject({ codigo: "FOUR032", nombre: "Yara 100mL EDP", precio: 36, precioSinIva: 31.3, ivaPorcentaje: 15, stock: 3, activo: true,
      dimensionesCm: { largo: 10, ancho: 7, alto: 14 }, pesoKg: 0.5 });
    expect(yara.imagenes[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/uploads\/products\/yara\.jpg$/);
    expect(hidden).toMatchObject({ codigo: "PERKE999", activo: false, stock: 0 });

    // Detrás del proxy de Railway las fotos deben salir con el protocolo público.
    const proxied = await signed("get", "/catalog").set("X-Forwarded-Proto", "https");
    expect(proxied.body.items[0].imagenes[0]).toMatch(/^https:\/\/127\.0\.0\.1:\d+\/uploads\//);
  });
});

describe("webhook de stock hacia Kestore", () => {
  it("envía todo la primera vez, nada si no cambió y solo lo que cambió después", async () => {
    const variant = await perfume({ stock: 5 });
    const calls: { body: string; headers: Record<string, string> }[] = [];
    const fetchOk = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ body: String(init!.body), headers: init!.headers as Record<string, string> });
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;

    await runKestoreSync(fetchOk);
    expect(calls).toHaveLength(1);
    const { headers, body } = calls[0];
    expect(isValidKestoreSignature(SECRET, headers["X-Crm-Timestamp"], headers["X-Crm-Signature"], Buffer.from(body))).toBe(true);
    expect(JSON.parse(body).items).toEqual([{ codigo: "FOUR032", stock: 5, precio: 36, precioSinIva: 31.3, activo: true }]);

    await runKestoreSync(fetchOk);
    expect(calls).toHaveLength(1);

    await prisma.productVariant.update({ where: { id: variant.id }, data: { reservedStock: 1 } });
    await runKestoreSync(fetchOk);
    expect(JSON.parse(calls[1].body).items).toEqual([{ codigo: "FOUR032", stock: 4, precio: 36, precioSinIva: 31.3, activo: true }]);

    // Al cambiar el código, el viejo se despublica y el nuevo se publica.
    await prisma.productVariant.update({ where: { id: variant.id }, data: { kestoreCode: "FOUR099" } });
    await runKestoreSync(fetchOk);
    expect(JSON.parse(calls[2].body).items.map((i: { codigo: string; activo: boolean }) => [i.codigo, i.activo])).toEqual([["FOUR032", false], ["FOUR099", true]]);
  });

  it("si Kestore falla no marca nada como enviado y reintenta", async () => {
    await perfume();
    const fetchFail = vi.fn(async () => new Response("caído", { status: 500 })) as unknown as typeof fetch;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await runKestoreSync(fetchFail);
    expect(fetchFail).toHaveBeenCalledTimes(1);
    expect(await prisma.kestoreSyncState.count()).toBe(0);
    expect((await pendingKestoreChanges()).items).toHaveLength(1);
    error.mockRestore();
  });
});

describe("pedidos de Kestore", () => {
  const order = { pedido: "KE-1001", items: [{ codigo: "FOUR032", cantidad: 2 }], envio: { provincia: "Pichincha", ciudad: "Quito", direccion: "Av. Amazonas" }, cliente: { nombre: "Ana Pérez", telefono: "0999999999" } };

  beforeEach(async () => {
    const wholesaler = await createWholesalerFixture({ defaultCreditDays: 15 });
    vi.stubEnv("KESTORE_WHOLESALER_RUC", wholesaler.ruc);
  });

  it("crea un despacho pendiente a precio mayorista, reserva stock y es idempotente", async () => {
    const variant = await perfume({ stock: 5 });
    const created = await signed("post", "/orders", order);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ ok: true, pedido: "KE-1001", estado: "PENDIENTE" });

    const dispatch = await prisma.dispatchOrder.findUniqueOrThrow({ where: { orderNumber: created.body.ordenCrm }, include: { items: true } });
    expect(dispatch).toMatchObject({ paymentMethod: "CREDITO", creditDays: 15, shippingCity: "Quito" });
    expect(dispatch.notes).toContain("Ana Pérez");
    expect(dispatch.items[0].unitPrice.toNumber()).toBe(31.3);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).reservedStock).toBe(2);

    const repeated = await signed("post", "/orders", order);
    expect(repeated.status).toBe(200);
    expect(repeated.body.ordenCrm).toBe(created.body.ordenCrm);
    expect(await prisma.dispatchOrder.count()).toBe(1);

    const changed = await signed("post", "/orders", { ...order, items: [{ codigo: "FOUR032", cantidad: 1 }] });
    expect(changed.status).toBe(409);
  });

  it("rechaza con el motivo cuando falta stock o el código no existe", async () => {
    await perfume({ stock: 1 });
    const res = await signed("post", "/orders", { ...order, items: [{ codigo: "FOUR032", cantidad: 2 }, { codigo: "NOPE", cantidad: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.items).toEqual([{ codigo: "FOUR032", motivo: "STOCK_INSUFICIENTE", disponible: 1 }, { codigo: "NOPE", motivo: "NO_EXISTE" }]);
    expect(await prisma.dispatchOrder.count()).toBe(0);
  });

  it("anula un pedido pendiente liberando la reserva; uno despachado no", async () => {
    const variant = await perfume({ stock: 5 });
    await signed("post", "/orders", order);
    const cancelled = await signed("post", "/orders/KE-1001/cancel");
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.estado).toBe("CANCELADO");
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).reservedStock).toBe(0);
    expect((await signed("post", "/orders/KE-1001/cancel")).status).toBe(200);
    expect((await signed("get", "/orders/KE-1001")).body.estado).toBe("CANCELADO");

    await signed("post", "/orders", { ...order, pedido: "KE-1002" });
    const second = await prisma.kestoreOrder.findUniqueOrThrow({ where: { orderNumber: "KE-1002" } });
    await prisma.dispatchOrder.update({ where: { id: second.dispatchOrderId }, data: { status: "DESPACHADO" } });
    expect((await signed("post", "/orders/KE-1002/cancel")).status).toBe(409);
  });

  it("responde 503 si no está configurado el mayorista Kestore", async () => {
    await perfume();
    vi.stubEnv("KESTORE_WHOLESALER_RUC", "");
    expect((await signed("post", "/orders", order)).status).toBe(503);
  });
});
