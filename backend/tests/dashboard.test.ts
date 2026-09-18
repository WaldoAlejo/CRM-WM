import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import {
  createCategoryFixture,
  createCourierFixture,
  createFinalCustomerFixture,
  createProductFixture,
  createTestUser,
  createVariantFixture,
  createVariantWithIngreso,
  createWholesalerFixture,
  prisma,
  resetDatabase,
} from "./helpers";

const app = createApp();

afterEach(async () => {
  await resetDatabase();
});

async function dispatchAndConfirm(
  token: string,
  variantId: string,
  quantity: number,
  unitPrice: number,
  overrides: { paymentMethod?: string; courierId?: string } = {}
) {
  const finalCustomer = await createFinalCustomerFixture();
  const created = await request(app)
    .post("/api/dispatch-orders")
    .set("Authorization", `Bearer ${token}`)
    .send({
      buyerType: "CLIENTE_FINAL",
      finalCustomerId: finalCustomer.id,
      shippingProvince: "Pichincha",
      shippingCity: "Quito",
      paymentMethod: overrides.paymentMethod ?? "CONTADO",
      items: [{ variantId, quantity, priceType: "PVP", unitPrice }],
    });

  const confirmBody = overrides.courierId ? { courierId: overrides.courierId } : {};
  const confirmed = await request(app)
    .post(`/api/dispatch-orders/${created.body.id}/confirm`)
    .set("Authorization", `Bearer ${token}`)
    .send(confirmBody);

  return confirmed.body;
}

describe("GET /api/dashboard/summary — forma de la respuesta por rol", () => {
  it("ADMIN recibe accountsReceivable e insuranceClaims, y sales con totalCost/profit/profitMarginPct", async () => {
    const { token } = await createTestUser("ADMIN");

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("accountsReceivable");
    expect(res.body).toHaveProperty("insuranceClaims");
    for (const period of ["today", "week", "month"] as const) {
      expect(res.body.sales[period]).toHaveProperty("totalCost");
      expect(res.body.sales[period]).toHaveProperty("profit");
      expect(res.body.sales[period]).toHaveProperty("profitMarginPct");
    }
  });

  it("OPERATOR NO recibe accountsReceivable ni insuranceClaims (ausentes, no null), y sales sin costo/ganancia", async () => {
    const { token } = await createTestUser("OPERATOR");

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    // hasOwnProperty, no solo "es null" — el campo debe estar AUSENTE.
    expect(Object.prototype.hasOwnProperty.call(res.body, "accountsReceivable")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, "insuranceClaims")).toBe(false);
    for (const period of ["today", "week", "month"] as const) {
      expect(Object.prototype.hasOwnProperty.call(res.body.sales[period], "totalCost")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(res.body.sales[period], "profit")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(res.body.sales[period], "profitMarginPct")).toBe(false);
    }
    // Lo que SÍ debe seguir viniendo: unidades y revenue (es precio de venta,
    // no costo — mismo criterio que unitPrice en DispatchOrderItem).
    expect(res.body.sales.today).toHaveProperty("unitsSold");
    expect(res.body.sales.today).toHaveProperty("totalRevenue");
  });

  it("stockAlerts y pendingCourierShipments vienen para los dos roles", async () => {
    const { token: adminToken } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");

    for (const token of [adminToken, operatorToken]) {
      const res = await request(app).get("/api/dashboard/summary").set("Authorization", `Bearer ${token}`);
      expect(res.body).toHaveProperty("stockAlerts");
      expect(res.body).toHaveProperty("pendingCourierShipments");
      expect(res.body.stockAlerts).toHaveProperty("count");
      expect(res.body.stockAlerts).toHaveProperty("items");
    }
  });
});

describe("GET /api/dashboard/summary — contenido de cada bloque", () => {
  it("stockAlerts.count refleja exactamente las variantes con stock < minStock (reusa getStockSummary)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    await createVariantFixture({ productId: product.id, stock: 2, minStock: 5 }); // bajo
    await createVariantFixture({ productId: product.id, stock: 10, minStock: 5 }); // ok

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", `Bearer ${token}`);

    expect(res.body.stockAlerts.count).toBe(1);
    expect(res.body.stockAlerts.items).toHaveLength(1);
    expect(res.body.stockAlerts.items[0].stock).toBe(2);
    expect(res.body.stockAlerts.items[0].minStock).toBe(5);
  });

  it("pendingCourierShipments.count cuenta los Shipment EN_TRANSITO", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const variant = await createVariantWithIngreso({ productId: product.id, quantity: 10, unitCost: 5 });
    const courier = await createCourierFixture();

    await dispatchAndConfirm(token, variant.id, 2, 20, { paymentMethod: "CONTRA_ENTREGA", courierId: courier.id });

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", `Bearer ${token}`);
    expect(res.body.pendingCourierShipments.count).toBe(1);
  });

  it("sales.today suma unitsSold/totalRevenue de lo despachado hoy (CONTADO)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const variant = await createVariantWithIngreso({ productId: product.id, quantity: 10, unitCost: 5 });

    await dispatchAndConfirm(token, variant.id, 3, 20); // 3 * $20 = $60

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", `Bearer ${token}`);
    expect(res.body.sales.today.unitsSold).toBe(3);
    expect(res.body.sales.today.totalRevenue).toBe("60");
    // También debe contar en la semana y el mes en curso (incluyen "hoy").
    expect(res.body.sales.week.unitsSold).toBeGreaterThanOrEqual(3);
    expect(res.body.sales.month.unitsSold).toBeGreaterThanOrEqual(3);
  });

  it("accountsReceivable refleja exactamente la misma definición que GET /accounts-receivable (CREDITO, vencida, no pagada)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const variant = await createVariantWithIngreso({ productId: product.id, quantity: 10, unitCost: 5 });
    // El crédito es exclusivo de mayoristas (el backend rechaza
    // CREDITO+CLIENTE_FINAL con 400) — mismo ajuste que ya hizo
    // accountsReceivable.e2e.test.tsx del frontend.
    const wholesaler = await createWholesalerFixture();

    const created = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        buyerType: "MAYORISTA",
        wholesalerId: wholesaler.id,
        shippingProvince: "Pichincha",
        shippingCity: "Quito",
        paymentMethod: "CREDITO",
        creditDays: 30,
        items: [{ variantId: variant.id, quantity: 2, priceType: "PVP", unitPrice: 20 }], // $40
      });
    await request(app)
      .post(`/api/dispatch-orders/${created.body.id}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    // Vencida: dueDate en el pasado (misma técnica que
    // accountsReceivable.e2e.test.tsx del frontend, acá directo con Prisma).
    await prisma.dispatchOrder.update({
      where: { id: created.body.id },
      data: { dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", `Bearer ${token}`);
    expect(res.body.accountsReceivable.overdueCount).toBe(1);
    expect(res.body.accountsReceivable.totalOutstanding).toBe("40");

    const arList = await request(app)
      .get("/api/accounts-receivable?pageSize=100")
      .set("Authorization", `Bearer ${token}`);
    expect(arList.body.pagination.total).toBe(res.body.accountsReceivable.overdueCount);
  });

  it("insuranceClaims.pendingCount cuenta reclamos PENDIENTE/EN_REVISION (OPEN_STATUSES)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const variant = await createVariantWithIngreso({ productId: product.id, quantity: 10, unitCost: 5 });
    const courier = await createCourierFixture();

    const order = await dispatchAndConfirm(token, variant.id, 1, 25, {
      paymentMethod: "CONTRA_ENTREGA",
      courierId: courier.id,
    });

    await request(app)
      .post(`/api/shipments/${order.shipment.id}/lost-or-damaged`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "PERDIDO" });

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", `Bearer ${token}`);
    expect(res.body.insuranceClaims.pendingCount).toBe(1);
  });
});
