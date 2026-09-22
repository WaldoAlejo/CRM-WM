import request from "supertest";
import { afterEach, beforeAll, describe, expect, it as vitestIt, vi } from "vitest";
import { createApp } from "../src/app";
import {
  createCategoryFixture,
  createLocationFixture,
  createProductFixture,
  createTestUser,
  createVariantWithIngreso,
  createWholesalerFixture,
  prisma,
  resetDatabase,
} from "./helpers";

const app = createApp();

// Los flujos de este archivo encadenan muchas llamadas contra la base remota.
//
// Subir el timeout solo hace MENOS probable un vencimiento; no elimina la
// carrera: cuando un test vence, Vitest lo marca fallido y ejecuta el
// afterEach MIENTRAS el cuerpo sigue corriendo — y ese afterEach trunca las
// tablas bajo los pies del test (así se ensució el test siguiente y hubo un
// deadlock en TRUNCATE). Por eso el cuerpo de cada test se registra en
// `inflight` y el afterEach lo ESPERA antes de truncar: el truncado nunca se
// ejecuta mientras un test de este archivo sigue tocando esos datos, venza o no.
vi.setConfig({ testTimeout: 90000, hookTimeout: 240000 });

let inflight: Promise<unknown> = Promise.resolve();
const it = (name: string, fn: () => Promise<void>, timeout?: number) =>
  vitestIt(
    name,
    () => {
      inflight = fn();
      return inflight;
    },
    timeout
  );
const DAY_MS = 24 * 60 * 60 * 1000;
const PRICE = 20;

// Una corrida interrumpida puede dejar movimientos de consignación en el
// schema de tests. El primer caso también necesita el mismo estado limpio.
beforeAll(resetDatabase);

afterEach(async () => {
  // Esperar (sin propagar el error: ese ya lo reporta el propio test) a que el
  // cuerpo termine de verdad antes de vaciar las tablas.
  await inflight.catch(() => undefined);
  await resetDatabase();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// Escenario base: variante con stock, mayorista con crédito de 30 días y una
// ubicación estándar (cuya bodega ya tiene su Cuarentena).
async function setup(stock = 100) {
  const { category } = await createCategoryFixture();
  const product = await createProductFixture({ categoryId: category.id });
  const variant = await createVariantWithIngreso({ productId: product.id, quantity: stock, unitCost: 10 });
  const wholesaler = await createWholesalerFixture({ defaultCreditDays: 30 });
  const location = await createLocationFixture();
  const admin = await createTestUser("ADMIN");
  const operator = await createTestUser("OPERATOR");
  return { variant, wholesaler, location, admin, operator };
}

async function createLot(
  token: string,
  s: Awaited<ReturnType<typeof setup>>,
  quantity = 100,
  extra: Record<string, unknown> = {}
) {
  return request(app)
    .post("/api/consignment/lots")
    .set(auth(token))
    .send({
      wholesalerId: s.wholesaler.id,
      shippingProvince: "Guayas",
      shippingCity: "Guayaquil",
      lines: [{ variantId: s.variant.id, quantity, unitPrice: PRICE, locationId: s.location.id }],
      ...extra,
    });
}

const stockOf = async (variantId: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stock;

function review(token: string, lotId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/consignment/lots/${lotId}/reviews`).set(auth(token)).send(body);
}

describe("Consignación — entrega del lote", () => {
  it("entrega sin generar cargo ni cuenta por cobrar: solo un movimiento CONSIGNACION y estado EN_CONSIGNACION", async () => {
    const s = await setup(100);
    const res = await createLot(s.admin.token, s, 60);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("EN_CONSIGNACION");
    expect(res.body.displayStatus).toBe("EN_CONSIGNACION");
    expect(res.body.code).toMatch(/^CON-\d{6}$/);
    expect(res.body.lines[0]).toMatchObject({ quantityDelivered: 60, sold: 0, returned: 0, pending: 60 });

    const days = (new Date(res.body.nextReviewDate).getTime() - new Date(res.body.deliveredAt).getTime()) / DAY_MS;
    expect(Math.round(days)).toBe(20);

    expect(await stockOf(s.variant.id)).toBe(40);
    const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { type: "CONSIGNACION" } });
    expect(movement.quantity).toBe(-60);
    expect(movement.fromLocationId).toBe(s.location.id);

    // Sin deuda: ninguna orden, ningún pago.
    expect(await prisma.dispatchOrder.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
  });

  it("OPERATOR no puede crear/ver lotes ni alertas (403); CEO sí", async () => {
    const s = await setup();
    expect((await createLot(s.operator.token, s)).status).toBe(403);
    expect((await request(app).get("/api/consignment/lots").set(auth(s.operator.token))).status).toBe(403);
    expect((await request(app).get("/api/consignment/alerts/overdue-reviews").set(auth(s.operator.token))).status).toBe(403);

    const ceo = await createTestUser("CEO");
    expect((await createLot(ceo.token, s, 10)).status).toBe(201);
  });

  it("siempre a crédito: exige creditDays si el mayorista no tiene un valor por defecto", async () => {
    const s = await setup();
    const noDefault = await createWholesalerFixture();
    const res = await createLot(s.admin.token, s, 10, { wholesalerId: noDefault.id });
    expect(res.status).toBe(400);
    expect((await createLot(s.admin.token, s, 10, { wholesalerId: noDefault.id, creditDays: 60 })).status).toBe(201);
  });

  it("no consigna más de lo disponible (stock menos lo reservado) ni deja movimientos a medias", async () => {
    const s = await setup(50);
    await prisma.productVariant.update({ where: { id: s.variant.id }, data: { reservedStock: 20 } });
    const res = await createLot(s.admin.token, s, 40); // disponible = 30
    expect(res.status).toBe(400);
    expect(await stockOf(s.variant.id)).toBe(50);
    expect(await prisma.consignmentLot.count()).toBe(0);
    expect(await prisma.inventoryMovement.count({ where: { type: "CONSIGNACION" } })).toBe(0);
  });
});

describe("Consignación — revisión: extender y vencida", () => {
  it("EXTENDER: sin cargo, sin devolución, el lote sigue abierto y la siguiente revisión cae a +20 días desde el registro", async () => {
    const s = await setup();
    const lot = (await createLot(s.admin.token, s, 50)).body;
    await prisma.consignmentLot.update({ where: { id: lot.id }, data: { nextReviewDate: new Date(Date.now() - 2 * DAY_MS) } });

    const res = await review(s.admin.token, lot.id, { action: "EXTENDER", notes: "Necesita más tiempo" });
    expect(res.status).toBe(201);
    expect(res.body.lot.status).toBe("EN_CONSIGNACION");
    expect(res.body.lot.displayStatus).toBe("EN_CONSIGNACION"); // ya no está vencida

    const days = (new Date(res.body.lot.nextReviewDate).getTime() - Date.now()) / DAY_MS;
    expect(Math.round(days)).toBe(20);
    expect(await prisma.dispatchOrder.count()).toBe(0);
    expect(await prisma.returnBatch.count()).toBe(0);
    expect(await stockOf(s.variant.id)).toBe(50);
  });

  it("EXTENDER con líneas es inválido (400)", async () => {
    const s = await setup();
    const lot = (await createLot(s.admin.token, s, 50)).body;
    const res = await review(s.admin.token, lot.id, {
      action: "EXTENDER",
      lines: [{ lineId: lot.lines[0].id, quantitySold: 1, quantityReturned: 0 }],
    });
    expect(res.status).toBe(400);
  });

  it("revisión vencida: aparece en la alerta como REVISION_VENCIDA pero NO se liquida ni se extiende sola", async () => {
    const s = await setup();
    const lot = (await createLot(s.admin.token, s, 50)).body;
    const other = (await createLot(s.admin.token, s, 10)).body; // vigente, no debe aparecer
    await prisma.consignmentLot.update({ where: { id: lot.id }, data: { nextReviewDate: new Date(Date.now() - 3 * DAY_MS) } });

    const alerts = await request(app).get("/api/consignment/alerts/overdue-reviews").set(auth(s.admin.token));
    expect(alerts.status).toBe(200);
    expect(alerts.body.count).toBe(1);
    expect(alerts.body.data[0]).toMatchObject({ id: lot.id, displayStatus: "REVISION_VENCIDA" });
    expect(alerts.body.data[0].daysOverdue).toBeGreaterThanOrEqual(3);
    expect(alerts.body.data.map((l: { id: string }) => l.id)).not.toContain(other.id);

    const listed = await request(app).get("/api/consignment/lots?overdue=true").set(auth(s.admin.token));
    expect(listed.body.data.map((l: { id: string }) => l.id)).toEqual([lot.id]);
    expect(listed.body.data[0].displayStatus).toBe("REVISION_VENCIDA");

    // Nada automático: mismo estado guardado, ninguna orden, ninguna revisión.
    const stored = await prisma.consignmentLot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(stored.status).toBe("EN_CONSIGNACION");
    expect(await prisma.consignmentReview.count()).toBe(0);
    expect(await prisma.dispatchOrder.count()).toBe(0);

    // Y el Dashboard la muestra a ADMIN.
    const dash = await request(app).get("/api/dashboard/summary").set(auth(s.admin.token));
    expect(dash.body.consignment.overdueReviewCount).toBe(1);
    const opDash = await request(app).get("/api/dashboard/summary").set(auth(s.operator.token));
    expect(opDash.body.consignment).toBeUndefined();
  });
});

describe("Consignación — liquidación parcial múltiple", () => {
  it("cada liquidación cobra SOLO lo vendido (crédito a 30 días); el lote se cierra cuando no queda pendiente", async () => {
    const s = await setup(100);
    const lot = (await createLot(s.admin.token, s, 100)).body;
    const lineId = lot.lines[0].id;

    // 1ª liquidación: "vendí 40 de 100" → se cobran 40, siguen 60 en consignación.
    const r1 = await review(s.admin.token, lot.id, {
      action: "LIQUIDAR",
      lines: [{ lineId, quantitySold: 40, quantityReturned: 0 }],
    });
    expect(r1.status).toBe(201);
    expect(r1.body.lot.status).toBe("LIQUIDADO_PARCIAL");
    expect(r1.body.lot.lines[0]).toMatchObject({ sold: 40, returned: 0, pending: 60 });
    expect(r1.body.review.chargeOrder).toBeTruthy();

    const order1 = await prisma.dispatchOrder.findUniqueOrThrow({
      where: { id: r1.body.review.chargeOrder.id },
      include: { items: true },
    });
    expect(order1).toMatchObject({
      origin: "CONSIGNACION_LIQUIDACION",
      paymentMethod: "CREDITO",
      status: "DESPACHADO",
      paymentStatus: "PENDIENTE",
      creditDays: 30,
      wholesalerId: s.wholesaler.id,
    });
    expect(order1.items).toHaveLength(1);
    expect(order1.items[0].quantity).toBe(40);
    expect(Number(order1.items[0].unitPrice)).toBe(PRICE);
    expect(Number(order1.items[0].unitCostSnapshot)).toBe(10); // congelado desde la entrega
    const due = (order1.dueDate!.getTime() - Date.now()) / DAY_MS;
    expect(Math.round(due)).toBe(30);
    // Sin doble descuento: el cargo no mueve stock.
    expect(await stockOf(s.variant.id)).toBe(0);
    expect(await prisma.inventoryMovement.count({ where: { dispatchOrderItemId: { not: null } } })).toBe(0);

    // Nuevo ciclo de 20 días.
    expect(Math.round((new Date(r1.body.lot.nextReviewDate).getTime() - Date.now()) / DAY_MS)).toBe(20);

    // 2ª liquidación: vendió 30 más y devuelve los 30 restantes → cierra el lote.
    const r2 = await review(s.admin.token, lot.id, {
      action: "LIQUIDAR",
      lines: [{ lineId, quantitySold: 30, quantityReturned: 30 }],
    });
    expect(r2.status).toBe(201);
    expect(r2.body.lot.status).toBe("CERRADO");
    expect(r2.body.lot.lines[0]).toMatchObject({ sold: 70, returned: 30, pending: 0 });
    expect(r2.body.review.nextReviewDate).toBeNull();

    // Dos cargos por lo vendido (40 y 30), uno por liquidación.
    const orders = await prisma.dispatchOrder.findMany({ where: { origin: "CONSIGNACION_LIQUIDACION" }, include: { items: true } });
    expect(orders.map((o) => o.items[0].quantity).sort()).toEqual([30, 40]);

    // Cerrado: no admite más revisiones.
    expect((await review(s.admin.token, lot.id, { action: "EXTENDER" })).status).toBe(409);
  });

  it("no acepta vender + devolver más de lo pendiente, ni líneas ajenas, ni líneas vacías", async () => {
    const s = await setup(100);
    const lot = (await createLot(s.admin.token, s, 10)).body;
    const lineId = lot.lines[0].id;

    const over = await review(s.admin.token, lot.id, { action: "LIQUIDAR", lines: [{ lineId, quantitySold: 8, quantityReturned: 3 }] });
    expect(over.status).toBe(400);
    const foreign = await review(s.admin.token, lot.id, { action: "LIQUIDAR", lines: [{ lineId: "nope", quantitySold: 1, quantityReturned: 0 }] });
    expect(foreign.status).toBe(400);
    const empty = await review(s.admin.token, lot.id, { action: "LIQUIDAR", lines: [{ lineId, quantitySold: 0, quantityReturned: 0 }] });
    expect(empty.status).toBe(400);
    expect(await prisma.consignmentReview.count()).toBe(0);
    expect(await prisma.dispatchOrder.count()).toBe(0);
  });

  it("si la bodega no tiene Cuarentena activa, liquidar con devoluciones es 409 y no persiste nada", async () => {
    const s = await setup(100);
    const lot = (await createLot(s.admin.token, s, 10)).body;
    await prisma.location.deleteMany({ where: { type: "CUARENTENA" } });

    const res = await review(s.admin.token, lot.id, {
      action: "LIQUIDAR",
      lines: [{ lineId: lot.lines[0].id, quantitySold: 4, quantityReturned: 6 }],
    });
    expect(res.status).toBe(409);
    expect(await prisma.consignmentReview.count()).toBe(0);
    expect(await prisma.dispatchOrder.count()).toBe(0); // ni siquiera el cargo por lo vendido
    expect((await prisma.consignmentLot.findUniqueOrThrow({ where: { id: lot.id } })).status).toBe("EN_CONSIGNACION");
  });
});

describe("Cuarentena — checklist de devoluciones de consignación", () => {
  // Lote de 10 → liquida devolviendo 6 (y vendiendo 4). Devuelve la línea de devolución.
  async function liquidateWithReturns(s: Awaited<ReturnType<typeof setup>>) {
    const lot = (await createLot(s.admin.token, s, 10)).body;
    await review(s.admin.token, lot.id, {
      action: "LIQUIDAR",
      lines: [{ lineId: lot.lines[0].id, quantitySold: 4, quantityReturned: 6 }],
    });
    const line = await prisma.returnLine.findFirstOrThrow({ where: { batch: { source: "CONSIGNACION" } } });
    return { lot, line };
  }

  const inspect = (token: string, lineId: string, body: Record<string, unknown>) =>
    request(app).post(`/api/quarantine/lines/${lineId}/inspections`).set(auth(token)).send(body);

  it("lo devuelto queda pendiente en la cola de Cuarentena, sin volver a stock y sin mostrar precios", async () => {
    const s = await setup(100);
    const { line } = await liquidateWithReturns(s);

    expect(await stockOf(s.variant.id)).toBe(90); // 100 − 10 entregados; lo devuelto aún no cuenta
    expect(await prisma.inventoryMovement.count({ where: { type: "DEVOLUCION" } })).toBe(0);

    for (const who of [s.operator, s.admin]) {
      const res = await request(app).get("/api/quarantine/queue").set(auth(who.token));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({ id: line.id, source: "CONSIGNACION", quantity: 6, remaining: 6 });
      expect(res.body.data[0].quarantineLocation.code).toBe("Cuarentena");
      expect(JSON.stringify(res.body)).not.toMatch(/price|cost|precio|costo/i);
    }
    expect((await request(app).get("/api/quarantine/queue")).status).toBe(401);
  });

  it("checklist que PASA: reingresa a la MISMA ubicación, referenciando la entrega, sin tratarse como ingreso nuevo ni generar cargo", async () => {
    const s = await setup(100);
    const { line } = await liquidateWithReturns(s);
    const delivery = await prisma.inventoryMovement.findFirstOrThrow({ where: { type: "CONSIGNACION" } });
    const ingresosBefore = await prisma.inventoryMovement.count({ where: { type: "INGRESO" } });

    const res = await inspect(s.operator.token, line.id, { quantity: 6, boxOk: true, noVisibleDamage: true, piecesComplete: true });
    expect(res.status).toBe(201);
    expect(res.body.inspection.result).toBe("PASA");
    expect(res.body).toMatchObject({ batchCompleted: true, chargeGenerated: false });

    expect(await stockOf(s.variant.id)).toBe(96); // 90 + 6
    const back = await prisma.inventoryMovement.findFirstOrThrow({ where: { type: "DEVOLUCION" } });
    expect(back.quantity).toBe(6);
    expect(back.toLocationId).toBe(s.location.id);
    expect(back.originMovementId).toBe(delivery.id);
    // No es un ingreso nuevo: el costo promedio (solo INGRESO) queda intacto.
    expect(await prisma.inventoryMovement.count({ where: { type: "INGRESO" } })).toBe(ingresosBefore);

    // Solo existe el cargo por lo vendido; nada por no conformes.
    expect(await prisma.dispatchOrder.count({ where: { origin: "CONSIGNACION_DEVOLUCION_NO_CONFORME" } })).toBe(0);
    expect(await prisma.dispatchOrder.count()).toBe(1);
  });

  it("checklist que NO PASA: el mayorista paga lo no conforme al precio de venta (2º cargo a crédito desde la fecha de inspección) y no vuelve stock", async () => {
    const s = await setup(100);
    const { line } = await liquidateWithReturns(s);

    const res = await inspect(s.operator.token, line.id, {
      quantity: 6,
      boxOk: true,
      noVisibleDamage: false,
      piecesComplete: true,
      observation: "Rayones visibles",
    });
    expect(res.status).toBe(201);
    expect(res.body.inspection.result).toBe("NO_PASA");
    expect(res.body).toMatchObject({ batchCompleted: true, chargeGenerated: true });

    expect(await stockOf(s.variant.id)).toBe(90); // no reingresó
    expect(await prisma.inventoryMovement.count({ where: { type: "DEVOLUCION" } })).toBe(0);

    const charge = await prisma.dispatchOrder.findFirstOrThrow({
      where: { origin: "CONSIGNACION_DEVOLUCION_NO_CONFORME" },
      include: { items: true },
    });
    expect(charge).toMatchObject({ paymentMethod: "CREDITO", status: "DESPACHADO", creditDays: 30, wholesalerId: s.wholesaler.id });
    expect(charge.items).toHaveLength(1);
    expect(charge.items[0].quantity).toBe(6);
    expect(Number(charge.items[0].unitPrice)).toBe(PRICE); // mismo precio que una unidad vendida
    expect(Math.round((charge.dueDate!.getTime() - Date.now()) / DAY_MS)).toBe(30);

    // Es una cuenta por cobrar normal: un pago la salda, con el ledger de siempre.
    const paid = await request(app)
      .post(`/api/dispatch-orders/${charge.id}/payments`)
      .set(auth(s.admin.token))
      .send({ amount: 6 * PRICE, method: "transferencia" });
    expect(paid.status).toBe(201);
    expect((await prisma.dispatchOrder.findUniqueOrThrow({ where: { id: charge.id } })).paymentStatus).toBe("PAGADO");

    // Y se vuelve visible en Cuentas por Cobrar cuando vence (mismo `where` de siempre).
    const other = await prisma.dispatchOrder.findFirstOrThrow({ where: { origin: "CONSIGNACION_LIQUIDACION" } });
    await prisma.dispatchOrder.update({ where: { id: other.id }, data: { dueDate: new Date(Date.now() - DAY_MS) } });
    const ar = await request(app).get("/api/accounts-receivable").set(auth(s.admin.token));
    expect(ar.body.data.map((o: { id: string }) => o.id)).toContain(other.id);
  });

  it("una línea puede dividirse: 5 pasan y 1 no; el cargo (solo de 1 unidad) nace al inspeccionar la última", async () => {
    const s = await setup(100);
    const { line } = await liquidateWithReturns(s);

    const first = await inspect(s.operator.token, line.id, { quantity: 5, boxOk: true, noVisibleDamage: true, piecesComplete: true });
    expect(first.body).toMatchObject({ batchCompleted: false, chargeGenerated: false });
    expect(first.body.line.remaining).toBe(1);
    expect(await stockOf(s.variant.id)).toBe(95);

    const second = await inspect(s.operator.token, line.id, { quantity: 1, boxOk: false, noVisibleDamage: true, piecesComplete: true });
    expect(second.body).toMatchObject({ batchCompleted: true, chargeGenerated: true });

    const charge = await prisma.dispatchOrder.findFirstOrThrow({
      where: { origin: "CONSIGNACION_DEVOLUCION_NO_CONFORME" },
      include: { items: true },
    });
    expect(charge.items[0].quantity).toBe(1);
    expect(await stockOf(s.variant.id)).toBe(95);
  });

  it("no se puede inspeccionar más de lo pendiente ni una línea ya completa; el resultado lo decide el servidor", async () => {
    const s = await setup(100);
    const { line } = await liquidateWithReturns(s);

    expect((await inspect(s.operator.token, line.id, { quantity: 7, boxOk: true, noVisibleDamage: true, piecesComplete: true })).status).toBe(400);
    expect(await prisma.returnInspection.count()).toBe(0);

    // Un cliente que manda su propio "result" no logra forzar un PASA con un ítem fallido.
    const forged = await inspect(s.operator.token, line.id, {
      quantity: 6,
      boxOk: true,
      noVisibleDamage: true,
      piecesComplete: false,
      result: "PASA",
    });
    expect(forged.body.inspection.result).toBe("NO_PASA");

    expect((await inspect(s.operator.token, line.id, { quantity: 1, boxOk: true, noVisibleDamage: true, piecesComplete: true })).status).toBe(409);
    expect((await inspect(s.operator.token, "inexistente", { quantity: 1, boxOk: true, noVisibleDamage: true, piecesComplete: true })).status).toBe(404);
  });
});

describe("Cuarentena — concurrencia", () => {
  it("dos inspecciones simultáneas de las últimas unidades de líneas distintas cierran el lote UNA vez y generan UN solo cargo", async () => {
    const s = await setup(100);
    const { category } = await createCategoryFixture();
    const product2 = await createProductFixture({ categoryId: category.id });
    const variant2 = await createVariantWithIngreso({ productId: product2.id, quantity: 100, unitCost: 10 });

    const lot = (
      await createLot(s.admin.token, s, 4, {
        lines: [
          { variantId: s.variant.id, quantity: 4, unitPrice: PRICE, locationId: s.location.id },
          { variantId: variant2.id, quantity: 4, unitPrice: PRICE, locationId: s.location.id },
        ],
      })
    ).body;
    await review(s.admin.token, lot.id, {
      action: "LIQUIDAR",
      lines: lot.lines.map((l: { id: string }) => ({ lineId: l.id, quantitySold: 3, quantityReturned: 1 })),
    });
    const lines = await prisma.returnLine.findMany({});
    expect(lines).toHaveLength(2);

    const results = await Promise.all(
      lines.map((l) =>
        request(app)
          .post(`/api/quarantine/lines/${l.id}/inspections`)
          .set(auth(s.operator.token))
          .send({ quantity: 1, boxOk: false, noVisibleDamage: true, piecesComplete: true })
      )
    );
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results.filter((r) => r.body.batchCompleted)).toHaveLength(1);
    expect(results.filter((r) => r.body.chargeGenerated)).toHaveLength(1);

    const charges = await prisma.dispatchOrder.findMany({
      where: { origin: "CONSIGNACION_DEVOLUCION_NO_CONFORME" },
      include: { items: true },
    });
    expect(charges).toHaveLength(1);
    expect(charges[0].items).toHaveLength(2); // una unidad no conforme de cada línea
    expect((await prisma.returnBatch.findFirstOrThrow({})).completedAt).not.toBeNull();
  }, 60000);
});

describe("Bodegas y ubicaciones con Cuarentena", () => {
  it("toda bodega nueva nace con su Cuarentena, pero esta no aparece en el listado normal ni es elegible como origen de despacho", async () => {
    const admin = await createTestUser("ADMIN");
    const created = await request(app).post("/api/warehouses").set(auth(admin.token)).send({ name: "Bodega Norte" });
    expect(created.status).toBe(201);
    expect(created.body.locations).toEqual([]);

    const quarantines = await prisma.location.findMany({ where: { warehouseId: created.body.id, type: "CUARENTENA" } });
    expect(quarantines).toHaveLength(1);
    expect(quarantines[0].isActive).toBe(true);

    const listed = await request(app).get(`/api/warehouses/${created.body.id}/locations`).set(auth(admin.token));
    expect(listed.body).toEqual([]);

    // Como origen de un despacho: se rechaza igual que una ubicación inexistente.
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const variant = await createVariantWithIngreso({ productId: product.id, quantity: 5, unitCost: 1 });
    const wholesaler = await createWholesalerFixture({ defaultCreditDays: 30 });
    const order = await request(app)
      .post("/api/dispatch-orders")
      .set(auth(admin.token))
      .send({
        buyerType: "MAYORISTA",
        wholesalerId: wholesaler.id,
        shippingProvince: "Guayas",
        shippingCity: "Guayaquil",
        paymentMethod: "CREDITO",
        items: [{ variantId: variant.id, quantity: 1, priceType: "MAYORISTA", unitPrice: 5, locationId: quarantines[0].id }],
      });
    expect(order.status).toBe(400);
  });

  it("dar de baja una bodega da de baja también su Cuarentena, salvo que tenga devoluciones pendientes (409)", async () => {
    const s = await setup(100);
    const warehouseId = s.location.warehouseId;
    const lot = (await createLot(s.admin.token, s, 10)).body;
    await review(s.admin.token, lot.id, { action: "LIQUIDAR", lines: [{ lineId: lot.lines[0].id, quantitySold: 0, quantityReturned: 10 }] });
    await prisma.location.update({ where: { id: s.location.id }, data: { isActive: false } });

    const blocked = await request(app).delete(`/api/warehouses/${warehouseId}`).set(auth(s.admin.token));
    expect(blocked.status).toBe(409);

    const line = await prisma.returnLine.findFirstOrThrow({});
    await request(app)
      .post(`/api/quarantine/lines/${line.id}/inspections`)
      .set(auth(s.operator.token))
      .send({ quantity: 10, boxOk: true, noVisibleDamage: true, piecesComplete: true });

    const ok = await request(app).delete(`/api/warehouses/${warehouseId}`).set(auth(s.admin.token));
    expect(ok.status).toBeLessThan(300);
    const q = await prisma.location.findFirstOrThrow({ where: { warehouseId, type: "CUARENTENA" } });
    expect(q.isActive).toBe(false);
  });
});
