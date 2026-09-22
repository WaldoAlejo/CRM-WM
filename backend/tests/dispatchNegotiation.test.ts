import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createCategoryFixture, createProductFixture, createTestUser, createVariantWithIngreso, createWholesalerFixture, createFinalCustomerFixture, prisma, resetDatabase } from "./helpers";
const app = createApp();
afterEach(resetDatabase);
async function setup() {
  const { token } = await createTestUser("ADMIN");
  const { category } = await createCategoryFixture();
  const product = await createProductFixture({ categoryId: category.id });
  const variant = await createVariantWithIngreso({ productId: product.id, quantity: 100, unitCost: 18 });
  await prisma.inventoryMovement.updateMany({ where: { variantId: variant.id }, data: { landedCostPerUnit: 14.747899 } });
  return { token, variant };
}
function body(buyer: { wholesalerId?: string; finalCustomerId?: string }, variantId: string, markupPct: number) {
  return { ...buyer, buyerType: buyer.wholesalerId ? "MAYORISTA" : "CLIENTE_FINAL", shippingProvince: "Pichincha", shippingCity: "Quito", paymentMethod: "CONTADO", items: [{ variantId, quantity: 2, priceType: buyer.wholesalerId ? "MAYORISTA" : "PVP", markupPct, expectedRealCost: 32.75 }] };
}
describe("Negociación sobre costo real por comprador", () => {
  it("guarda 70/80/90% por mayorista y 100/120% por cliente y reporta ganancias separadas", async () => {
    const { token, variant } = await setup();
    const cases = [ [70, 55.68], [80, 58.95], [90, 62.23], [100, 65.50], [120, 72.05] ];
    const sales = [];
    for (const [pct, price] of cases) {
      const buyer = pct < 100 ? { wholesalerId: (await createWholesalerFixture()).id } : { finalCustomerId: (await createFinalCustomerFixture()).id };
      const created = await request(app).post("/api/dispatch-orders").set("Authorization", `Bearer ${token}`).send({ ...body(buyer, variant.id, pct), items: [{ ...body(buyer, variant.id, pct).items[0], unitPrice: 1 }] });
      expect(created.status).toBe(201);
      expect(Number(created.body.items[0].markupPct)).toBe(pct);
      expect(Number(created.body.items[0].unitPrice)).toBe(price);
      expect(Number(created.body.items[0].landedCostSnapshot)).toBe(32.75);
      sales.push({ id: created.body.id, buyerId: buyer.wholesalerId ?? buyer.finalCustomerId, price });
    }
    // A later import must not change the negotiated basis or price at confirmation.
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, type: "INGRESO", quantity: 100, stockAfter: 200, unitCost: 100, landedCostPerUnit: 10 } });
    for (const sale of sales) {
      const confirmed = await request(app).post(`/api/dispatch-orders/${sale.id}/confirm`).set("Authorization", `Bearer ${token}`).send({});
      expect(confirmed.status).toBe(200);
      expect(Number(confirmed.body.items[0].landedCostSnapshot)).toBe(32.75);
      expect(Number(confirmed.body.items[0].unitPrice)).toBe(sale.price);
    }
    const report = await request(app).get("/api/reports/profitability/summary").set("Authorization", `Bearer ${token}`);
    expect(report.status).toBe(200);
    expect(report.body.byBuyer).toHaveLength(5);
    for (const sale of sales) {
      const row = report.body.byBuyer.find((r: { buyerId: string }) => r.buyerId === sale.buyerId);
      expect(Number(row.totalCost)).toBe(65.50);
      expect(Number(row.totalRevenue)).toBeCloseTo(sale.price * 2, 2);
      expect(Number(row.profit)).toBeCloseTo((sale.price - 32.75) * 2, 2);
    }
  }, 60000);
  it("valida porcentajes, rechaza descuentos combinados y avisa si cambió el costo", async () => {
    const { token, variant } = await setup();
    const buyer = { finalCustomerId: (await createFinalCustomerFixture()).id };
    for (const pct of [-1, 10001, 70.001]) {
      expect((await request(app).post("/api/dispatch-orders").set("Authorization", `Bearer ${token}`).send(body(buyer, variant.id, pct))).status).toBe(400);
    }
    const data = body(buyer, variant.id, 120);
    expect((await request(app).post("/api/dispatch-orders").set("Authorization", `Bearer ${token}`).send({ ...data, items: [{ ...data.items[0], discountPct: 10 }] })).status).toBe(400);
    expect((await request(app).post("/api/dispatch-orders").set("Authorization", `Bearer ${token}`).send({ ...data, items: [{ ...data.items[0], expectedRealCost: 30 }] })).status).toBe(409);
    expect(await prisma.dispatchOrder.count()).toBe(0);
    const quote = await request(app).get(`/api/dispatch-orders/pricing/${variant.id}`).set("Authorization", `Bearer ${token}`);
    expect(Number(quote.body.realCost)).toBe(32.75);
  });
  it("oculta costo y porcentaje a operadores y protege la consulta de negociación", async () => {
    const { token, variant } = await setup();
    const { token: operator } = await createTestUser("OPERATOR");
    const buyer = { finalCustomerId: (await createFinalCustomerFixture()).id };
    const data = body(buyer, variant.id, 100);
    const created = await request(app).post("/api/dispatch-orders").set("Authorization", `Bearer ${token}`).send(data);
    const view = await request(app).get(`/api/dispatch-orders/${created.body.id}`).set("Authorization", `Bearer ${operator}`);
    expect(view.body.items[0]).not.toHaveProperty("markupPct");
    expect(view.body.items[0]).not.toHaveProperty("landedCostSnapshot");
    expect((await request(app).get(`/api/dispatch-orders/pricing/${variant.id}`).set("Authorization", `Bearer ${operator}`)).status).toBe(403);
    expect((await request(app).post("/api/dispatch-orders").set("Authorization", `Bearer ${operator}`).send(data)).status).toBe(403);
  });
});
