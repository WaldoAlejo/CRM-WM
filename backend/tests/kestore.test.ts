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

  it("agrega la variante al nombre cuando el producto tiene más de una", async () => {
    const variant = await perfume();
    await perfume({ code: "PERKE999" });
    const other = await createVariantFixture({ productId: variant.productId });
    await prisma.productVariant.update({ where: { id: other.id }, data: { label: "200 mL", kestoreCode: "FOUR033", wholesalePrice: 50 } });
    await prisma.productVariant.update({ where: { id: variant.id }, data: { label: "100 mL" } });
    const items = (await signed("get", "/catalog")).body.items as { codigo: string; nombre: string }[];
    const byCode = Object.fromEntries(items.map((i) => [i.codigo, i.nombre]));
    expect(byCode).toMatchObject({ FOUR032: "Yara 100mL EDP - 100 mL", FOUR033: "Yara 100mL EDP - 200 mL", PERKE999: "Yara 100mL EDP" });
  });

  it("usa la descripción de la variante si tiene una; si no, la del producto", async () => {
    const variant = await perfume();
    const other = await createVariantFixture({ productId: variant.productId });
    await prisma.product.update({ where: { id: variant.productId }, data: { description: "Ficha general" } });
    await prisma.productVariant.update({ where: { id: other.id }, data: { kestoreCode: "FOUR033", wholesalePrice: 50, description: "Ficha del modelo con pantalla" } });
    await prisma.productVariant.update({ where: { id: variant.id }, data: { description: "   " } });
    const items = (await signed("get", "/catalog")).body.items as { codigo: string; descripcion: string }[];
    const byCode = Object.fromEntries(items.map((i) => [i.codigo, i.descripcion]));
    expect(byCode).toMatchObject({ FOUR032: "Ficha general", FOUR033: "Ficha del modelo con pantalla" });
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

describe("kestore-dev como segundo destino", () => {
  const DEV_SECRET = "d".repeat(40);
  const DEV_URL = "https://kestore-dev.test/crm/webhook/stock";

  beforeEach(() => {
    vi.stubEnv("KESTORE_DEV_WEBHOOK_SECRET", DEV_SECRET);
    vi.stubEnv("KESTORE_DEV_WEBHOOK_URL", DEV_URL);
  });

  function signedDev(method: "get" | "post", path: string, body?: unknown) {
    const raw = body === undefined ? "" : JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const req = request(app)[method](`${BASE}${path}`)
      .set("X-Crm-Timestamp", timestamp)
      .set("X-Crm-Signature", signKestorePayload(DEV_SECRET, timestamp, raw));
    return body === undefined ? req : req.set("Content-Type", "application/json").send(raw);
  }

  it("envía primero a kestore-dev y luego a producción; lo de 'Solo kestore-dev' va inactivo a producción", async () => {
    const variant = await perfume({ stock: 5 });
    await prisma.product.update({ where: { id: variant.productId }, data: { kestoreDevOnly: true } });
    const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
    const fetchOk = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init!.body), headers: init!.headers as Record<string, string> });
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;

    // Producción no conocía el producto y no se publica allá: no se le envía nada.
    await runKestoreSync(fetchOk);
    expect(calls.map((c) => c.url)).toEqual([DEV_URL]);
    expect(isValidKestoreSignature(DEV_SECRET, calls[0].headers["X-Crm-Timestamp"], calls[0].headers["X-Crm-Signature"], Buffer.from(calls[0].body))).toBe(true);
    expect(JSON.parse(calls[0].body).items).toEqual([{ codigo: "FOUR032", stock: 5, precio: 36, precioSinIva: 31.3, activo: true }]);

    // Al aprobarlo para producción, se publica allá; kestore-dev no cambia.
    await prisma.product.update({ where: { id: variant.productId }, data: { kestoreDevOnly: false } });
    await runKestoreSync(fetchOk);
    expect(calls.map((c) => c.url)).toEqual([DEV_URL, "https://kestore.test/crm/webhook/stock"]);
    expect(JSON.parse(calls[1].body).items).toEqual([{ codigo: "FOUR032", stock: 5, precio: 36, precioSinIva: 31.3, activo: true }]);

    // Si vuelve a quedar solo para kestore-dev, producción lo recibe inactivo.
    await prisma.product.update({ where: { id: variant.productId }, data: { kestoreDevOnly: true } });
    await runKestoreSync(fetchOk);
    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[2].body).items).toEqual([{ codigo: "FOUR032", stock: 0, precio: 36, precioSinIva: 31.3, activo: false }]);
    expect(await prisma.kestoreSyncState.count()).toBe(2);
  });

  it("si kestore-dev falla, producción igual recibe sus cambios", async () => {
    await perfume();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchDevDown = vi.fn(async (url: string | URL | Request) =>
      new Response(String(url) === DEV_URL ? "caído" : '{"ok":true}', { status: String(url) === DEV_URL ? 500 : 200 })) as unknown as typeof fetch;
    await runKestoreSync(fetchDevDown);
    expect(fetchDevDown).toHaveBeenCalledTimes(2);
    expect(await prisma.kestoreSyncState.findMany({ select: { target: true } })).toEqual([{ target: "PROD" }]);
    expect((await pendingKestoreChanges("DEV")).items).toHaveLength(1);
    error.mockRestore();
  });

  it("el catálogo pedido por kestore-dev publica lo de 'Solo kestore-dev'; el de producción no", async () => {
    const variant = await perfume();
    await prisma.product.update({ where: { id: variant.productId }, data: { kestoreDevOnly: true } });
    expect((await signedDev("get", "/catalog")).body.items[0]).toMatchObject({ codigo: "FOUR032", activo: true, stock: 5 });
    expect((await signed("get", "/catalog")).body.items[0]).toMatchObject({ codigo: "FOUR032", activo: false, stock: 0 });
  });

  it("kestore-dev no puede registrar ni consultar pedidos", async () => {
    await perfume();
    const order = { pedido: "KE-DEV-1", items: [{ codigo: "FOUR032", cantidad: 1 }], envio: { provincia: "Pichincha", ciudad: "Quito", direccion: "Av. Amazonas" } };
    expect((await signedDev("post", "/orders", order)).status).toBe(403);
    expect((await signedDev("get", "/orders/KE-DEV-1")).status).toBe(403);
    expect((await signedDev("post", "/orders/KE-DEV-1/cancel")).status).toBe(403);
    expect(await prisma.dispatchOrder.count()).toBe(0);
  });

  it("un secreto de dev igual al de producción no habilita a kestore-dev", async () => {
    vi.stubEnv("KESTORE_DEV_WEBHOOK_SECRET", SECRET);
    await perfume();
    const fetchOk = vi.fn(async () => new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch;
    await runKestoreSync(fetchOk);
    expect(fetchOk).toHaveBeenCalledTimes(1);
    expect(fetchOk).toHaveBeenCalledWith("https://kestore.test/crm/webhook/stock", expect.anything());
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
