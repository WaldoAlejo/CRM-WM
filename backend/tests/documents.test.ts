import request from "supertest";
import { afterEach, describe, expect, it as test, vi } from "vitest";
import { createApp } from "../src/app";
import * as docs from "../src/modules/documents/documents.service";
import {
  createCategoryFixture, createProductFixture, createVariantWithIngreso, createWholesalerFixture,
  createLocationFixture, createTestUser, createImportBatchFixture, createCourierFixture, prisma, resetDatabase,
} from "./helpers";

vi.setConfig({ testTimeout: 120000, hookTimeout: 240000 });
const app = createApp();
let inflight: Promise<unknown> = Promise.resolve();
const it = (name: string, body: () => Promise<void>) => test(name, () => { inflight = body(); return inflight; });
afterEach(async () => { await inflight.catch(() => undefined); await resetDatabase(); });

async function setup() {
  const { category } = await createCategoryFixture();
  const product = await createProductFixture({ categoryId: category.id });
  const variant = await createVariantWithIngreso({ productId: product.id, quantity: 100, unitCost: 170 });
  const wholesaler = await createWholesalerFixture({ defaultCreditDays: 30 });
  const location = await createLocationFixture();
  const admin = await createTestUser("ADMIN");
  const operator = await createTestUser("OPERATOR");
  return { variant, wholesaler, location, admin, operator };
}
async function pdf(path: string, token: string) {
  const result = await request(app).get(`/api/documents${path}`).set("Authorization", `Bearer ${token}`);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.headers["content-type"]).toContain("application/pdf");
  expect(result.headers["cache-control"]).toBe("private, no-store");
  expect(result.headers["content-disposition"]).toContain("attachment;");
  expect(result.body.subarray(0, 5).toString()).toBe("%PDF-");
}

describe("PDF en los procesos operativos", () => {
  it("documenta ingresos, despacho confirmado y pagos; rechaza salidas inexistentes y pagos ajenos", async () => {
    const s = await setup();
    const batch = await createImportBatchFixture();
    const entry = await prisma.inventoryMovement.findFirstOrThrow({ where: { variantId: s.variant.id } });
    await prisma.inventoryMovement.update({ where: { id: entry.id }, data: {
      importBatchId: batch.id, toLocationId: s.location.id, volumeCbm: 3.79,
      packaging: { cartonCount: 25, unitsPerCarton: 4, maxStackCartons: 3 }, notes: "PRIVATE-ENTRY-NOTE",
    } });
    const order = await prisma.dispatchOrder.create({ data: {
      orderNumber: "OD-DOCUMENT-1", buyerType: "MAYORISTA", wholesalerId: s.wholesaler.id,
      shippingCity: "Guayaquil", shippingProvince: "Guayas", paymentMethod: "CREDITO", creditDays: 30,
      notes: "PRIVATE-ORDER-NOTE", items: { create: { variantId: s.variant.id, quantity: 2, unitPrice: 201, priceType: "MAYORISTA", unitCostSnapshot: 170, landedCostSnapshot: 180, markupPct: 20 } },
    }, include: { items: true } });
    expect((await request(app).get(`/api/documents/dispatch-orders/${order.id}`)).status).toBe(401);
    await pdf(`/dispatch-orders/${order.id}`, s.operator.token);
    expect((await request(app).get(`/api/documents/dispatch-orders/${order.id}/warehouse-out`).set("Authorization", `Bearer ${s.admin.token}`)).status).toBe(409);
    await prisma.dispatchOrder.update({ where: { id: order.id }, data: { status: "DESPACHADO", dispatchDate: new Date(), dueDate: new Date("2026-10-23T15:00Z") } });
    await prisma.inventoryMovement.create({ data: { variantId: s.variant.id, type: "SALIDA", quantity: -2, stockAfter: 98, fromLocationId: s.location.id, dispatchOrderItemId: order.items[0].id } });
    const p1 = await prisma.payment.create({ data: { dispatchOrderId: order.id, amount: 100, method: "efectivo", paidAt: new Date(), createdAt: new Date("2026-09-23T15:00Z"), notes: "PRIVATE-PAYMENT-NOTE", proofFile: "private-bank.jpg" } });
    const p2 = await prisma.payment.create({ data: { dispatchOrderId: order.id, amount: 302, method: "transferencia", paidAt: new Date("2026-09-22"), createdAt: new Date("2026-09-24T15:00Z") } });
    const countBefore = await prisma.inventoryMovement.count();
    await pdf(`/import-batches/${batch.id}`, s.operator.token);
    await pdf(`/movements/${entry.id}`, s.operator.token);
    await pdf(`/dispatch-orders/${order.id}/warehouse-out`, s.operator.token);
    await pdf(`/dispatch-orders/${order.id}`, s.admin.token);
    await pdf(`/dispatch-orders/${order.id}/payments/${p1.id}`, s.operator.token);
    await pdf(`/dispatch-orders/${order.id}/payments/${p2.id}`, s.admin.token);
    expect((await docs.getPaymentDocument(order.id, p1.id)).title).toBe("Comprobante de pago parcial");
    expect((await docs.getPaymentDocument(order.id, p2.id)).title).toBe("Comprobante de pago total");
    const serialized = JSON.stringify(await docs.getDispatchDocument(order.id));
    expect(serialized).not.toMatch(/PRIVATE|170\.00|180\.00|markup|Snapshot|private-bank/);
    expect((await docs.getImportDocument(batch.id)).rows[0].join(" ")).toContain("Cartones: 25");
    expect(await prisma.inventoryMovement.count()).toBe(countBefore);
    expect(await prisma.payment.count()).toBe(2);
    expect((await request(app).get(`/api/documents/dispatch-orders/${order.id}/payments/missing`).set("Authorization", `Bearer ${s.admin.token}`)).status).toBe(404);
    expect((await request(app).get("/api/documents/movements/missing").set("Authorization", `Bearer ${s.admin.token}`)).status).toBe(404);
  });

  it("acompaña consignación, liquidación y devolución antes y después de validarse", async () => {
    const s = await setup();
    const auth = { Authorization: `Bearer ${s.admin.token}` };
    const created = await request(app).post("/api/consignment/lots").set(auth).send({
      wholesalerId: s.wholesaler.id, shippingCity: "Guayaquil", shippingProvince: "Guayas",
      lines: [{ variantId: s.variant.id, quantity: 5, unitPrice: 201, locationId: s.location.id }],
    });
    expect(created.status).toBe(201);
    const lot = created.body;
    expect((await docs.getConsignmentDocument(lot.id)).notices.join(" ")).toContain("no genera un cobro inmediato");
    await pdf(`/consignments/${lot.id}`, s.admin.token);
    await pdf(`/consignments/${lot.id}/warehouse-out`, s.admin.token);
    expect((await request(app).get(`/api/documents/consignments/${lot.id}`).set("Authorization", `Bearer ${s.operator.token}`)).status).toBe(403);
    const reviewed = await request(app).post(`/api/consignment/lots/${lot.id}/reviews`).set(auth).send({
      action: "LIQUIDAR", lines: [{ lineId: lot.lines[0].id, quantitySold: 3, quantityReturned: 2 }],
    });
    expect(reviewed.status).toBe(201);
    const review = await prisma.consignmentReview.findFirstOrThrow({ where: { lotId: lot.id }, include: { chargeOrder: true, returnBatch: { include: { lines: true } } } });
    const batch = review.returnBatch!;
    await pdf(`/reviews/${review.id}`, s.admin.token);
    await pdf(`/dispatch-orders/${review.chargeOrder!.id}`, s.admin.token);
    expect((await request(app).get(`/api/documents/dispatch-orders/${review.chargeOrder!.id}/warehouse-out`).set(auth)).status).toBe(409);
    await pdf(`/returns/${batch.id}`, s.operator.token);
    expect((await docs.getReturnDocument(batch.id)).rows[0].slice(1)).toEqual(["2", "0", "0", "2"]);
    expect((await request(app).get(`/api/documents/returns/${batch.id}/warehouse-in`).set(auth)).status).toBe(409);
    const inspect = (quantity: number, boxOk: boolean) => request(app).post(`/api/quarantine/lines/${batch.lines[0].id}/inspections`).set(auth)
      .send({ quantity, boxOk, noVisibleDamage: true, piecesComplete: true });
    expect((await inspect(1, true)).status).toBe(201);
    await pdf(`/returns/${batch.id}/warehouse-in`, s.operator.token);
    expect((await inspect(1, false)).status).toBe(201);
    const complete = await docs.getReturnDocument(batch.id);
    expect(complete.rows[0].slice(1)).toEqual(["2", "1", "1", "0"]);
    expect(complete.fields).toContainEqual(["Estado", "Inspección completada"]);
    expect(complete.notices.join(" ")).toContain("Cargo por no conformes:");
    await pdf(`/returns/${batch.id}`, s.admin.token);
  });

  it("permite recuperar devoluciones del courier desde la orden original", async () => {
    const s = await setup();
    const courier = await createCourierFixture();
    const order = await prisma.dispatchOrder.create({ data: {
      orderNumber: "OD-RETURN", buyerType: "MAYORISTA", wholesalerId: s.wholesaler.id,
      shippingCity: "Guayaquil", shippingProvince: "Guayas", status: "DESPACHADO",
      items: { create: { variantId: s.variant.id, quantity: 1, unitPrice: 201, priceType: "MAYORISTA" } },
      shipment: { create: { courierId: courier.id, status: "RECHAZADO", isCOD: true } },
    }, include: { shipment: true } });
    await prisma.returnBatch.create({ data: { source: "COURIER_RECHAZADO", shipmentId: order.shipment!.id,
      lines: { create: { variantId: s.variant.id, quantity: 1, unitPrice: 201 } } } });
    await pdf(`/dispatch-orders/${order.id}/return`, s.operator.token);
    expect((await docs.getDispatchDocument(order.id)).notices.join(" ")).toContain("Envío con incidencia");
    expect((await request(app).get(`/api/documents/dispatch-orders/${order.id}/return-entry`).set("Authorization", `Bearer ${s.operator.token}`)).status).toBe(409);
  });
});
