import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import {
  createCategoryFixture,
  createProductFixture,
  createTestUser,
  createVariantWithIngreso,
  createWholesalerFixture,
  prisma,
  resetDatabase,
} from "./helpers";

const app = createApp();

afterEach(async () => {
  await resetDatabase();
});

async function setupVariant(quantity = 20, unitCost = 10) {
  const { category } = await createCategoryFixture();
  const product = await createProductFixture({ categoryId: category.id });
  const variant = await createVariantWithIngreso({ productId: product.id, quantity, unitCost });
  return variant;
}

// Crea una orden MAYORISTA a crédito y, opcionalmente, la confirma (deja de
// estar PENDIENTE y pasa a DESPACHADO).
async function createWholesalerOrder(
  token: string,
  wholesalerId: string,
  opts: { quantity?: number; unitPrice?: number; confirm?: boolean } = {}
) {
  const { quantity = 2, unitPrice = 50, confirm = false } = opts;
  const variant = await setupVariant(20, 10);

  const created = await request(app)
    .post("/api/dispatch-orders")
    .set("Authorization", `Bearer ${token}`)
    .send({
      buyerType: "MAYORISTA",
      wholesalerId,
      shippingProvince: "Pichincha",
      shippingCity: "Quito",
      paymentMethod: "CREDITO",
      creditDays: 30,
      items: [{ variantId: variant.id, quantity, priceType: "MAYORISTA", unitPrice }],
    });
  expect(created.status).toBe(201);

  if (!confirm) return created.body;

  const confirmed = await request(app)
    .post(`/api/dispatch-orders/${created.body.id}/confirm`)
    .set("Authorization", `Bearer ${token}`)
    .send({});
  expect(confirmed.status).toBe(200);
  return confirmed.body;
}

describe("PATCH /api/wholesalers/:id", () => {
  it("ADMIN puede editar", async () => {
    const { token } = await createTestUser("ADMIN");
    const wholesaler = await createWholesalerFixture();

    const res = await request(app)
      .patch(`/api/wholesalers/${wholesaler.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ phone: "0988888888" });

    expect(res.status).toBe(200);
    expect(res.body.phone).toBe("0988888888");
  });

  it("OPERATOR recibe 403", async () => {
    const { token } = await createTestUser("OPERATOR");
    const wholesaler = await createWholesalerFixture();

    const res = await request(app)
      .patch(`/api/wholesalers/${wholesaler.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ phone: "0988888888" });

    expect(res.status).toBe(403);
  });

  it("404 si el mayorista no existe", async () => {
    const { token } = await createTestUser("ADMIN");

    const res = await request(app)
      .patch("/api/wholesalers/id-inexistente")
      .set("Authorization", `Bearer ${token}`)
      .send({ phone: "0988888888" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/wholesalers/:id", () => {
  it("OPERATOR recibe 403", async () => {
    const { token } = await createTestUser("OPERATOR");
    const wholesaler = await createWholesalerFixture();

    const res = await request(app)
      .delete(`/api/wholesalers/${wholesaler.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("permite eliminar un mayorista sin órdenes pendientes ni deuda activa", async () => {
    const { token } = await createTestUser("ADMIN");
    const wholesaler = await createWholesalerFixture();

    const res = await request(app)
      .delete(`/api/wholesalers/${wholesaler.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(204);

    const stored = await prisma.wholesaler.findUniqueOrThrow({ where: { id: wholesaler.id } });
    expect(stored.deletedAt).not.toBeNull();

    const list = await request(app).get("/api/wholesalers").set("Authorization", `Bearer ${token}`);
    expect(list.body.map((w: { id: string }) => w.id)).not.toContain(wholesaler.id);
  });

  it("bloquea con 409 si hay una orden PENDIENTE de despacho (sin mencionar cuentas por cobrar)", async () => {
    const { token } = await createTestUser("ADMIN");
    const wholesaler = await createWholesalerFixture();
    await createWholesalerOrder(token, wholesaler.id, { confirm: false }); // queda PENDIENTE

    const res = await request(app)
      .delete(`/api/wholesalers/${wholesaler.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/hay 1 orden\(es\) pendiente\(s\) de despacho/);
    expect(res.body.error).not.toMatch(/cuentas por cobrar/);
    expect(res.body.reasons).toHaveLength(1);

    const stored = await prisma.wholesaler.findUniqueOrThrow({ where: { id: wholesaler.id } });
    expect(stored.deletedAt).toBeNull(); // no se tocó
  });

  it("bloquea con 409 si tiene cuentas por cobrar activas (CREDITO, DESPACHADO, saldo pendiente) — sin mencionar despachos pendientes", async () => {
    const { token } = await createTestUser("ADMIN");
    const wholesaler = await createWholesalerFixture();
    // total = 50 * 2 = 100
    const order = await createWholesalerOrder(token, wholesaler.id, { quantity: 2, unitPrice: 50, confirm: true });

    // Pago parcial de 25: saldo pendiente real = 75, no el total de 100.
    const payment = await request(app)
      .post(`/api/dispatch-orders/${order.id}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 25, method: "transferencia" });
    expect(payment.status).toBe(201);
    expect(payment.body.paymentStatus).toBe("PARCIAL");

    const res = await request(app)
      .delete(`/api/wholesalers/${wholesaler.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/\$75 en cuentas por cobrar pendientes/);
    expect(res.body.error).not.toMatch(/pendiente\(s\) de despacho/);
    expect(res.body.reasons).toHaveLength(1);
  });

  it("muestra AMBOS motivos si aplican los dos a la vez", async () => {
    const { token } = await createTestUser("ADMIN");
    const wholesaler = await createWholesalerFixture();

    await createWholesalerOrder(token, wholesaler.id, { confirm: false }); // PENDIENTE
    await createWholesalerOrder(token, wholesaler.id, { quantity: 1, unitPrice: 40, confirm: true }); // DESPACHADO, deuda = 40

    const res = await request(app)
      .delete(`/api/wholesalers/${wholesaler.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/orden\(es\) pendiente\(s\) de despacho/);
    expect(res.body.error).toMatch(/\$40 en cuentas por cobrar pendientes/);
    expect(res.body.reasons).toHaveLength(2);
  });

  it("una orden DESPACHADO ya pagada por completo (CREDITO) no bloquea nada", async () => {
    const { token } = await createTestUser("ADMIN");
    const wholesaler = await createWholesalerFixture();
    const order = await createWholesalerOrder(token, wholesaler.id, { quantity: 2, unitPrice: 50, confirm: true });

    const payment = await request(app)
      .post(`/api/dispatch-orders/${order.id}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 100, method: "transferencia" });
    expect(payment.body.paymentStatus).toBe("PAGADO");

    const res = await request(app)
      .delete(`/api/wholesalers/${wholesaler.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(204);
  });
});
