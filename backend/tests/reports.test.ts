import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import {
  createCategoryFixture,
  createCourierFixture,
  createFinalCustomerFixture,
  createProductFixture,
  createTestUser,
  createVariantWithIngreso,
  prisma,
  resetDatabase,
} from "./helpers";

const app = createApp();

afterEach(async () => {
  await resetDatabase();
});

async function setupVariant(quantity = 20, unitCost = 10, landedCostPerUnit = 0) {
  const { category } = await createCategoryFixture();
  const product = await createProductFixture({ categoryId: category.id });
  const variant = await createVariantWithIngreso({ productId: product.id, quantity, unitCost });
  if (landedCostPerUnit) {
    await prisma.inventoryMovement.updateMany({
      where: { variantId: variant.id, type: "INGRESO" },
      data: { landedCostPerUnit },
    });
  }
  return { category, product, variant };
}

async function createAndConfirmOrder(
  token: string,
  variantId: string,
  opts: { quantity?: number; unitPrice?: number; cod?: boolean; courierId?: string } = {}
) {
  const { quantity = 1, unitPrice = 100, cod = false, courierId } = opts;
  const finalCustomer = await createFinalCustomerFixture();
  const created = await request(app)
    .post("/api/dispatch-orders")
    .set("Authorization", `Bearer ${token}`)
    .send({
      buyerType: "CLIENTE_FINAL",
      finalCustomerId: finalCustomer.id,
      shippingProvince: "Pichincha",
      shippingCity: "Quito",
      paymentMethod: cod ? "CONTRA_ENTREGA" : "CONTADO",
      items: [{ variantId, quantity, priceType: "PVP", unitPrice }],
    });

  const confirmed = await request(app)
    .post(`/api/dispatch-orders/${created.body.id}/confirm`)
    .set("Authorization", `Bearer ${token}`)
    .send(cod ? { courierId } : {});

  return confirmed.body;
}

describe("GET /api/reports/profitability", () => {
  it("solo ADMIN puede acceder", async () => {
    const { token } = await createTestUser("OPERATOR");

    const res = await request(app)
      .get("/api/reports/profitability")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("calcula totalRevenue (sin volver a aplicar discountPct) y totalCost (unitCostSnapshot + landedCostSnapshot)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant(20, 10, 3); // costo de aterrizaje por unidad = 13

    await createAndConfirmOrder(token, variant.id, { quantity: 4, unitPrice: 25 });

    const res = await request(app)
      .get("/api/reports/profitability")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.lines).toHaveLength(1);
    const line = res.body.lines[0];
    expect(line.unitsSold).toBe(4);
    expect(line.totalRevenue).toBe("100"); // 25 * 4, unitPrice ya neto
    expect(line.totalCost).toBe("52"); // 13 * 4
    expect(line.profit).toBe("48");
    expect(line.profitMarginPct).toBe("48");
    expect(res.body.totals.profit).toBe("48");
  });

  it("dos corridas del mismo reporte dan el mismo número aunque cambien costos/compras después (nunca recalcula en vivo)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant(20, 10, 3);
    await createAndConfirmOrder(token, variant.id, { quantity: 2, unitPrice: 25 });

    const first = await request(app)
      .get("/api/reports/profitability")
      .set("Authorization", `Bearer ${token}`);

    // Llega un ingreso nuevo, mucho más caro, DESPUÉS de la venta ya confirmada.
    await prisma.inventoryMovement.create({
      data: {
        variantId: variant.id,
        type: "INGRESO",
        quantity: 100,
        unitCost: 999,
        landedCostPerUnit: 999,
        stockAfter: 118,
      },
    });

    const second = await request(app)
      .get("/api/reports/profitability")
      .set("Authorization", `Bearer ${token}`);

    expect(second.body.lines[0].totalCost).toBe(first.body.lines[0].totalCost);
    expect(second.body.totals).toEqual(first.body.totals);
  });

  it("trata landedCostSnapshot=null (orden confirmada antes de que el campo existiera) como costo adicional 0", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant(20, 10, 3);
    const order = await createAndConfirmOrder(token, variant.id, { quantity: 2, unitPrice: 25 });

    // Simula una orden histórica: landedCostSnapshot nunca se llenó.
    await prisma.dispatchOrderItem.updateMany({
      where: { dispatchOrderId: order.id },
      data: { landedCostSnapshot: null },
    });

    const res = await request(app)
      .get("/api/reports/profitability")
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.lines[0].totalCost).toBe("20"); // solo unitCostSnapshot (10) * 2, sin romper el reporte
  });

  it("excluye ventas con Shipment RECHAZADO (el producto volvió a bodega, no hubo venta)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant(20, 10);
    const courier = await createCourierFixture();
    const confirmed = await createAndConfirmOrder(token, variant.id, {
      quantity: 2,
      unitPrice: 25,
      cod: true,
      courierId: courier.id,
    });

    await request(app)
      .post(`/api/shipments/${confirmed.shipment.id}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rejectionReason: "Cliente no estaba en casa" });

    const res = await request(app)
      .get("/api/reports/profitability")
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.lines).toHaveLength(0);
    expect(res.body.totals.unitsSold).toBe(0);
  });

  it("mercadería PERDIDO/DANADO va a ventasConReclamoPendiente mientras el InsuranceClaim no esté PAGADO", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant(20, 10);
    const courier = await createCourierFixture();
    const confirmed = await createAndConfirmOrder(token, variant.id, {
      quantity: 2,
      unitPrice: 25,
      cod: true,
      courierId: courier.id,
    });

    await request(app)
      .post(`/api/shipments/${confirmed.shipment.id}/lost-or-damaged`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "PERDIDO" });

    const res = await request(app)
      .get("/api/reports/profitability")
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.lines).toHaveLength(0);
    expect(res.body.totals.unitsSold).toBe(0);
    expect(res.body.ventasConReclamoPendiente.lines).toHaveLength(1);
    expect(res.body.ventasConReclamoPendiente.totals.unitsSold).toBe(2);
  });

  it("una vez el InsuranceClaim pasa a PAGADO, la venta cuenta como normal", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant(20, 10);
    const courier = await createCourierFixture();
    const confirmed = await createAndConfirmOrder(token, variant.id, {
      quantity: 2,
      unitPrice: 25,
      cod: true,
      courierId: courier.id,
    });

    await request(app)
      .post(`/api/shipments/${confirmed.shipment.id}/lost-or-damaged`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "DANADO" });

    await prisma.insuranceClaim.updateMany({
      where: { shipmentId: confirmed.shipment.id },
      data: { status: "PAGADO" },
    });

    const res = await request(app)
      .get("/api/reports/profitability")
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.lines).toHaveLength(1);
    expect(res.body.ventasConReclamoPendiente.lines).toHaveLength(0);
  });

  it("filtra por rango de fechas (dispatchDate)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant(20, 10);
    await createAndConfirmOrder(token, variant.id, { quantity: 2, unitPrice: 25 });

    const outsideRange = await request(app)
      .get("/api/reports/profitability")
      .query({ dateFrom: "2000-01-01", dateTo: "2000-01-02" })
      .set("Authorization", `Bearer ${token}`);
    expect(outsideRange.body.lines).toHaveLength(0);

    const wideRange = await request(app)
      .get("/api/reports/profitability")
      .query({ dateFrom: "2000-01-01", dateTo: "2100-01-01" })
      .set("Authorization", `Bearer ${token}`);
    expect(wideRange.body.lines).toHaveLength(1);
  });
});

describe("GET /api/reports/profitability/summary", () => {
  it("agrega por categoría y arma el top de productos por ganancia", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant: v1 } = await setupVariant(20, 10);
    const { variant: v2 } = await setupVariant(20, 5);
    await createAndConfirmOrder(token, v1.id, { quantity: 2, unitPrice: 25 }); // profit 30
    await createAndConfirmOrder(token, v2.id, { quantity: 2, unitPrice: 15 }); // profit 20

    const res = await request(app)
      .get("/api/reports/profitability/summary")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.totals.profit).toBe("50");
    expect(res.body.byCategory).toHaveLength(2);
    expect(res.body.topProductsByProfit[0].profit).toBe("30");
  });

  it("solo ADMIN puede acceder", async () => {
    const { token } = await createTestUser("OPERATOR");

    const res = await request(app)
      .get("/api/reports/profitability/summary")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("dateTo=hoy incluye una venta despachada hoy mismo (regresión del bug de endOfDay)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant(20, 10);
    // dispatchDate queda en "new Date()" real (ahora mismo), no una fecha de fixture.
    await createAndConfirmOrder(token, variant.id, { quantity: 3, unitPrice: 25 });

    // Mismo formato que envía el frontend: solo fecha, sin hora. z.coerce.date()
    // lo parsea como medianoche UTC de hoy — si el backend no corriera ese
    // límite al final del día, un despacho de hoy hecho después de esa hora
    // quedaría afuera del reporte "hasta hoy".
    const today = new Date().toISOString().slice(0, 10);

    const res = await request(app)
      .get("/api/reports/profitability/summary")
      .query({ dateTo: today })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.totals.unitsSold).toBe(3);
    expect(res.body.totals.totalRevenue).toBe("75"); // 25 * 3
  });
});
