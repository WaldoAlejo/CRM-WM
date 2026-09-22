// Semáforo de cuentas por cobrar en la API: listado, detalle y Dashboard. Los
// bordes de milisegundos se prueban con `now` inyectado en receivableStatus.test.ts;
// acá los offsets llevan margen porque el servidor usa su propio reloj.
import { randomUUID } from "crypto";
import request from "supertest";
import { afterEach, describe, expect, vi } from "vitest";
import { createApp } from "../src/app";
import {
  createCategoryFixture,
  createProductFixture,
  createTestUser,
  createVariantFixture,
  prisma,
  resetDatabase,
} from "./helpers";
import { it, settleInflight } from "./inflight";

const app = createApp();
vi.setConfig({ testTimeout: 60000 });
const DAY_MS = 24 * 60 * 60 * 1000;

let wholesalerId: string | undefined;

afterEach(async () => {
  await settleInflight(); // nunca truncar mientras el cuerpo de un test sigue corriendo
  await resetDatabase();
  wholesalerId = undefined; // el mayorista cacheado murió con el truncado
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function wholesaler() {
  wholesalerId ??= (
    await prisma.wholesaler.create({
      data: { businessName: `Mayorista ${randomUUID().slice(0, 6)}`, ruc: Array.from({ length: 13 }, () => Math.floor(Math.random() * 10)).join("") },
    })
  ).id;
  return wholesalerId;
}

// Cuenta CREDITO ya despachada (total = `total`), con vencimiento relativo a AHORA.
async function credit(opts: { dueInDays: number; total?: number; paid?: number; method?: "CREDITO" | "CONTADO" }) {
  const { category } = await createCategoryFixture();
  const product = await createProductFixture({ categoryId: category.id });
  const variant = await createVariantFixture({ productId: product.id, stock: 50 });
  const total = opts.total ?? 100;
  const paid = opts.paid ?? 0;
  return prisma.dispatchOrder.create({
    data: {
      orderNumber: `OD-S${randomUUID().slice(0, 8)}`,
      buyerType: "MAYORISTA",
      wholesalerId: await wholesaler(),
      shippingProvince: "Guayas",
      shippingCity: "Guayaquil",
      status: "DESPACHADO",
      dispatchDate: new Date(),
      paymentMethod: opts.method ?? "CREDITO",
      creditDays: 30,
      dueDate: new Date(Date.now() + opts.dueInDays * DAY_MS),
      amountPaid: paid > 0 ? paid : undefined,
      paymentStatus: paid >= total ? "PAGADO" : paid > 0 ? "PARCIAL" : "PENDIENTE",
      items: { create: [{ variantId: variant.id, quantity: 1, priceType: "MAYORISTA", unitPrice: total }] },
    },
  });
}

// Un caso de cada color (+ el rojo con abono parcial).
async function seedAllStates() {
  return {
    pendiente: await credit({ dueInDays: 30 }),
    pendienteBorde: await credit({ dueInDays: 8 }),
    porVencer: await credit({ dueInDays: 3 }),
    porVencerBorde: await credit({ dueInDays: 6.9 }),
    vencida: await credit({ dueInDays: -1, total: 100 }),
    vencidaConAbono: await credit({ dueInDays: -2, total: 100, paid: 40 }),
    completada: await credit({ dueInDays: -5, total: 100, paid: 100 }),
    completadaFutura: await credit({ dueInDays: 20, total: 100, paid: 100 }),
  };
}

describe("GET /api/accounts-receivable — semáforo en el listado", () => {
  it("SIN filtro sigue siendo el listado de siempre (solo vencidas), ahora marcadas VENCIDO — incluida la que tiene abono parcial", async () => {
    const admin = await createTestUser("ADMIN");
    const s = await seedAllStates();

    const res = await request(app).get("/api/accounts-receivable").set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data.map((o: { id: string }) => o.id).sort()).toEqual([s.vencida.id, s.vencidaConAbono.id].sort());
    for (const row of res.body.data) expect(row.collectionStatus).toBe("VENCIDO");
    const partial = res.body.data.find((o: { id: string }) => o.id === s.vencidaConAbono.id);
    expect(partial.paymentStatus).toBe("PARCIAL"); // tiene abono…
    expect(partial.collectionStatus).toBe("VENCIDO"); // …y sigue ROJA, no amarilla
  });

  it("status=POR_VENCER / PENDIENTE / COMPLETADO devuelven cada grupo con su color", async () => {
    const admin = await createTestUser("ADMIN");
    const s = await seedAllStates();
    const ids = async (status: string) => {
      const res = await request(app).get(`/api/accounts-receivable?status=${status}`).set(auth(admin.token));
      expect(res.status).toBe(200);
      for (const row of res.body.data) expect(row.collectionStatus, status).toBe(status);
      return res.body.data.map((o: { id: string }) => o.id).sort();
    };

    expect(await ids("POR_VENCER")).toEqual([s.porVencer.id, s.porVencerBorde.id].sort());
    expect(await ids("PENDIENTE")).toEqual([s.pendiente.id, s.pendienteBorde.id].sort());
    expect(await ids("COMPLETADO")).toEqual([s.completada.id, s.completadaFutura.id].sort());
    expect(await ids("VENCIDO")).toEqual([s.vencida.id, s.vencidaConAbono.id].sort());
  });

  it("status=TODAS lista todas las cuentas a crédito con su semáforo (un color por cuenta); contado y sin fecha no aparecen", async () => {
    const admin = await createTestUser("ADMIN");
    const s = await seedAllStates();
    await credit({ dueInDays: -3, method: "CONTADO" }); // no es crédito

    const res = await request(app).get("/api/accounts-receivable?status=TODAS").set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(8);
    const colorOf = (id: string) => res.body.data.find((o: { id: string }) => o.id === id).collectionStatus;
    expect(colorOf(s.pendiente.id)).toBe("PENDIENTE");
    expect(colorOf(s.pendienteBorde.id)).toBe("PENDIENTE");
    expect(colorOf(s.porVencer.id)).toBe("POR_VENCER");
    expect(colorOf(s.porVencerBorde.id)).toBe("POR_VENCER");
    expect(colorOf(s.vencida.id)).toBe("VENCIDO");
    expect(colorOf(s.vencidaConAbono.id)).toBe("VENCIDO");
    expect(colorOf(s.completada.id)).toBe("COMPLETADO");
    expect(colorOf(s.completadaFutura.id)).toBe("COMPLETADO");
  });

  it("status inválido → 400; OPERATOR sigue sin acceso (403)", async () => {
    const admin = await createTestUser("ADMIN");
    const operator = await createTestUser("OPERATOR");
    expect((await request(app).get("/api/accounts-receivable?status=ROJO").set(auth(admin.token))).status).toBe(400);
    expect((await request(app).get("/api/accounts-receivable?status=TODAS").set(auth(operator.token))).status).toBe(403);
  });
});

describe("GET /api/dispatch-orders/:id — semáforo en el detalle", () => {
  it("cada cuenta trae su collectionStatus (también para OPERATOR, que ya ve fecha y estado de pago); una orden de contado, null", async () => {
    const admin = await createTestUser("ADMIN");
    const operator = await createTestUser("OPERATOR");
    const s = await seedAllStates();
    const cash = await credit({ dueInDays: 5, method: "CONTADO" });

    const expected: [string, string | null][] = [
      [s.pendiente.id, "PENDIENTE"],
      [s.porVencer.id, "POR_VENCER"],
      [s.vencida.id, "VENCIDO"],
      [s.vencidaConAbono.id, "VENCIDO"],
      [s.completada.id, "COMPLETADO"],
      [cash.id, null],
    ];
    for (const who of [admin, operator]) {
      for (const [id, status] of expected) {
        const res = await request(app).get(`/api/dispatch-orders/${id}`).set(auth(who.token));
        expect(res.status).toBe(200);
        expect(res.body.collectionStatus, `${who.user.role} ${id}`).toBe(status);
      }
    }
  });

  it("el estado se DERIVA al consultar: pagar el saldo de una cuenta vencida la pasa de rojo a verde, sin ningún campo guardado", async () => {
    const admin = await createTestUser("ADMIN");
    const order = await credit({ dueInDays: -2, total: 100 });
    const stored = await prisma.dispatchOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect("collectionStatus" in stored).toBe(false); // no existe columna: se calcula
    const status = async () => (await request(app).get(`/api/dispatch-orders/${order.id}`).set(auth(admin.token))).body.collectionStatus;
    const pay = (amount: number) =>
      request(app).post(`/api/dispatch-orders/${order.id}/payments`).set(auth(admin.token)).send({ amount, method: "efectivo" });

    expect(await status()).toBe("VENCIDO");

    // Pagos parciales reales por el ledger: siguen en rojo (no pasan a amarillo).
    await pay(40);
    expect((await request(app).get(`/api/dispatch-orders/${order.id}`).set(auth(admin.token))).body.paymentStatus).toBe("PARCIAL");
    expect(await status()).toBe("VENCIDO");
    await pay(10);
    expect(await status()).toBe("VENCIDO");

    // Solo el pago completo la pone verde.
    await pay(50);
    expect(await status()).toBe("COMPLETADO");
  });
});

describe("GET /api/dashboard/summary — semáforo en el bloque de cartera", () => {
  it("byStatus desglosa vencidas / por vencer / pendientes con su saldo; overdueCount y totalOutstanding no cambian de significado", async () => {
    const admin = await createTestUser("ADMIN");
    await seedAllStates();

    const res = await request(app).get("/api/dashboard/summary").set(auth(admin.token));
    const ar = res.body.accountsReceivable;

    // Lo de siempre: SOLO las vencidas (100 + saldo 60 de la del abono).
    expect(ar.overdueCount).toBe(2);
    expect(ar.totalOutstanding).toBe("160");

    expect(ar.byStatus.VENCIDO).toEqual({ count: 2, outstanding: "160" });
    expect(ar.byStatus.POR_VENCER).toEqual({ count: 2, outstanding: "200" });
    expect(ar.byStatus.PENDIENTE).toEqual({ count: 2, outstanding: "200" });
    // Las completadas no cuentan como cartera.
    expect(Object.keys(ar.byStatus).sort()).toEqual(["PENDIENTE", "POR_VENCER", "VENCIDO"]);
  });

  it("OPERATOR sigue sin recibir nada de cartera (ausente, no null)", async () => {
    const operator = await createTestUser("OPERATOR");
    await seedAllStates();
    const res = await request(app).get("/api/dashboard/summary").set(auth(operator.token));
    expect(Object.prototype.hasOwnProperty.call(res.body, "accountsReceivable")).toBe(false);
  });
});
