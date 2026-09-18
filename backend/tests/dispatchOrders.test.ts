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
  return { category, product, variant };
}

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    buyerType: "CLIENTE_FINAL",
    shippingProvince: "Pichincha",
    shippingCity: "Quito",
    paymentMethod: "CONTADO",
    items: [],
    ...overrides,
  };
}

describe("POST /api/dispatch-orders", () => {
  it("crea la orden y reserva stock (reservedStock sube, stock no cambia)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant(20);
    const finalCustomer = await createFinalCustomerFixture();

    const res = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send(
        orderBody({
          finalCustomerId: finalCustomer.id,
          items: [{ variantId: variant.id, quantity: 5, priceType: "PVP", unitPrice: 20 }],
        })
      );

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDIENTE");
    expect(res.body.orderNumber).toMatch(/^OD-\d{6}$/);

    const updated = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updated.stock).toBe(20); // sin cambios
    expect(updated.reservedStock).toBe(5);
  });

  it("rechaza si no hay stock disponible, sin dejar reserva a medias", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant(3);
    const finalCustomer = await createFinalCustomerFixture();

    const res = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send(
        orderBody({
          finalCustomerId: finalCustomer.id,
          items: [{ variantId: variant.id, quantity: 10, priceType: "PVP", unitPrice: 20 }],
        })
      );

    expect(res.status).toBe(400);
    const unchanged = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(unchanged.reservedStock).toBe(0);
    const orders = await prisma.dispatchOrder.count();
    expect(orders).toBe(0); // la orden tampoco quedó creada: todo o nada
  });

  it("es atómico entre líneas: si la 2da línea no tiene stock, la 1ra tampoco se reserva", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant: v1 } = await setupVariant(20);
    const { variant: v2 } = await setupVariant(2);
    const finalCustomer = await createFinalCustomerFixture();

    const res = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send(
        orderBody({
          finalCustomerId: finalCustomer.id,
          items: [
            { variantId: v1.id, quantity: 5, priceType: "PVP", unitPrice: 20 },
            { variantId: v2.id, quantity: 10, priceType: "PVP", unitPrice: 20 },
          ],
        })
      );

    expect(res.status).toBe(400);
    const v1After = await prisma.productVariant.findUniqueOrThrow({ where: { id: v1.id } });
    expect(v1After.reservedStock).toBe(0);
  });

  it("rechaza buyerType=MAYORISTA sin wholesalerId", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant();

    const res = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send(
        orderBody({
          buyerType: "MAYORISTA",
          items: [{ variantId: variant.id, quantity: 1, priceType: "MAYORISTA", unitPrice: 10 }],
        })
      );

    expect(res.status).toBe(400);
  });

  it("rechaza CREDITO con buyerType=CLIENTE_FINAL", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant();
    const finalCustomer = await createFinalCustomerFixture();

    const res = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send(
        orderBody({
          finalCustomerId: finalCustomer.id,
          paymentMethod: "CREDITO",
          items: [{ variantId: variant.id, quantity: 1, priceType: "PVP", unitPrice: 10 }],
        })
      );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/MAYORISTA/);
  });

  it("CREDITO con MAYORISTA sin creditDays ni defaultCreditDays -> 400", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant();
    const wholesaler = await createWholesalerFixture(); // sin defaultCreditDays

    const res = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send(
        orderBody({
          buyerType: "MAYORISTA",
          wholesalerId: wholesaler.id,
          paymentMethod: "CREDITO",
          items: [{ variantId: variant.id, quantity: 1, priceType: "MAYORISTA", unitPrice: 10 }],
        })
      );

    expect(res.status).toBe(400);
  });

  it("CREDITO con MAYORISTA hereda defaultCreditDays si no viene explícito", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant();
    const wholesaler = await createWholesalerFixture({ defaultCreditDays: 45 });

    const res = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send(
        orderBody({
          buyerType: "MAYORISTA",
          wholesalerId: wholesaler.id,
          paymentMethod: "CREDITO",
          items: [{ variantId: variant.id, quantity: 1, priceType: "MAYORISTA", unitPrice: 10 }],
        })
      );

    expect(res.status).toBe(201);
    expect(res.body.creditDays).toBe(45);
    expect(res.body.dueDate).toBeNull(); // recién se calcula al confirmar
  });

  it("rechaza un variantId repetido en items, con el SKU en el mensaje", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant(20);
    const finalCustomer = await createFinalCustomerFixture();

    const res = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send(
        orderBody({
          finalCustomerId: finalCustomer.id,
          items: [
            { variantId: variant.id, quantity: 2, priceType: "PVP", unitPrice: 20 },
            { variantId: variant.id, quantity: 3, priceType: "PVP", unitPrice: 20 },
          ],
        })
      );

    expect(res.status).toBe(400);
    expect(res.body.field).toBe("items");
    expect(res.body.error).toContain(variant.sku);
  });

  // Reemplaza al viejo dispatchOrder.count()+1 (documentado como "no a
  // prueba de una carrera concurrente real" desde el Módulo 4) por un
  // contador atómico con lock de fila — este test es el que demuestra que
  // el problema real quedó resuelto, no solo mitigado corriendo los tests
  // en serie. Promise.all de 10 requests SÍ overlapea de verdad a nivel de
  // transacciones Postgres: cada request handler es async y cede el control
  // en cada await de I/O real contra Neon.
  it("10 órdenes creadas en paralelo (concurrencia real): orderNumbers distintos y consecutivos, sin colisiones", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant(50);
    const finalCustomer = await createFinalCustomerFixture();

    const requests = Array.from({ length: 10 }, () =>
      request(app)
        .post("/api/dispatch-orders")
        .set("Authorization", `Bearer ${token}`)
        .send(
          orderBody({
            finalCustomerId: finalCustomer.id,
            items: [{ variantId: variant.id, quantity: 1, priceType: "PVP", unitPrice: 10 }],
          })
        )
    );

    const responses = await Promise.all(requests);

    responses.forEach((res) => expect(res.status).toBe(201));

    const numbers = responses.map((res) => Number(res.body.orderNumber.replace("OD-", "")));
    expect(new Set(numbers).size).toBe(10);

    const sorted = [...numbers].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]).toBe(sorted[i - 1] + 1);
    }
  });
});

describe("POST /api/dispatch-orders/:id/confirm", () => {
  async function createPendingOrder(token: string, variantId: string, quantity = 5) {
    const finalCustomer = await createFinalCustomerFixture();
    const res = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send(
        orderBody({
          finalCustomerId: finalCustomer.id,
          items: [{ variantId, quantity, priceType: "PVP", unitPrice: 20 }],
        })
      );
    return res.body;
  }

  it("aplica SALIDA, calcula unitCostSnapshot como promedio ponderado, y libera reservedStock", async () => {
    const { token, user } = await createTestUser("ADMIN");
    const { variant } = await setupVariant(20, 12.5);
    const order = await createPendingOrder(token, variant.id, 5);

    const res = await request(app)
      .post(`/api/dispatch-orders/${order.id}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DESPACHADO");
    expect(res.body.items[0].unitCostSnapshot).toBe("12.5");

    const updatedVariant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updatedVariant.stock).toBe(15); // 20 - 5
    expect(updatedVariant.reservedStock).toBe(0);

    const movement = await prisma.inventoryMovement.findFirst({ where: { variantId: variant.id, type: "SALIDA" } });
    expect(movement?.quantity).toBe(-5);
    expect(movement?.stockAfter).toBe(15);
    expect(movement?.createdById).toBe(user.id);
  });

  it("promedio ponderado combina dos ingresos con costos distintos", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const variant = await createVariantWithIngreso({ productId: product.id, quantity: 10, unitCost: 10 });
    // segundo ingreso con costo distinto
    await prisma.inventoryMovement.create({
      data: { variantId: variant.id, type: "INGRESO", quantity: 10, unitCost: 20, stockAfter: 20 },
    });
    await prisma.productVariant.update({ where: { id: variant.id }, data: { stock: 20 } });

    const order = await createPendingOrder(token, variant.id, 4);
    const res = await request(app)
      .post(`/api/dispatch-orders/${order.id}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    // (10*10 + 10*20) / 20 = 15
    expect(res.body.items[0].unitCostSnapshot).toBe("15");
  });

  it("calcula dueDate = dispatchDate + creditDays para órdenes CREDITO", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant();
    const wholesaler = await createWholesalerFixture({ defaultCreditDays: 30 });

    const created = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send(
        orderBody({
          buyerType: "MAYORISTA",
          wholesalerId: wholesaler.id,
          paymentMethod: "CREDITO",
          items: [{ variantId: variant.id, quantity: 1, priceType: "MAYORISTA", unitPrice: 10 }],
        })
      );
    expect(created.body.dueDate).toBeNull();

    const confirmed = await request(app)
      .post(`/api/dispatch-orders/${created.body.id}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(confirmed.body.dueDate).not.toBeNull();
    const dispatchDate = new Date(confirmed.body.dispatchDate);
    const dueDate = new Date(confirmed.body.dueDate);
    const diffDays = Math.round((dueDate.getTime() - dispatchDate.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(30);
  });

  it("CONTRA_ENTREGA sin courierId -> 400", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant();
    const finalCustomer = await createFinalCustomerFixture();

    const created = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send(
        orderBody({
          finalCustomerId: finalCustomer.id,
          paymentMethod: "CONTRA_ENTREGA",
          items: [{ variantId: variant.id, quantity: 1, priceType: "PVP", unitPrice: 10 }],
        })
      );

    const res = await request(app)
      .post(`/api/dispatch-orders/${created.body.id}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it("CONTRA_ENTREGA crea el Shipment EN_TRANSITO con codAmountExpected correcto", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant();
    const finalCustomer = await createFinalCustomerFixture();
    const courier = await createCourierFixture();

    const created = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send(
        orderBody({
          finalCustomerId: finalCustomer.id,
          paymentMethod: "CONTRA_ENTREGA",
          items: [{ variantId: variant.id, quantity: 3, priceType: "PVP", unitPrice: 25 }],
        })
      );

    const res = await request(app)
      .post(`/api/dispatch-orders/${created.body.id}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .send({ courierId: courier.id, trackingNumber: "GUIA-123" });

    expect(res.status).toBe(200);
    expect(res.body.shipment.status).toBe("EN_TRANSITO");
    expect(res.body.shipment.isCOD).toBe(true);
    expect(res.body.shipment.codAmountExpected).toBe("75"); // 25 * 3
  });

  it("rechaza confirmar una orden ya CANCELADA", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant();
    const order = await createPendingOrder(token, variant.id, 1);

    await request(app)
      .post(`/api/dispatch-orders/${order.id}/cancel`)
      .set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/dispatch-orders/${order.id}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/PENDIENTE/);
  });

  it("un segundo confirm sobre una orden ya DESPACHADA rechaza y NO duplica la salida de stock", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant(20);
    const order = await createPendingOrder(token, variant.id, 5);

    const first = await request(app)
      .post(`/api/dispatch-orders/${order.id}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/dispatch-orders/${order.id}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(second.status).toBe(409);

    const updated = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updated.stock).toBe(15); // 20 - 5, UNA sola vez
    const salidaCount = await prisma.inventoryMovement.count({ where: { variantId: variant.id, type: "SALIDA" } });
    expect(salidaCount).toBe(1);
  });

  it("oculta unitCostSnapshot para OPERATOR", async () => {
    const { token: adminToken } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const { variant } = await setupVariant(20, 8);
    const order = await createPendingOrder(adminToken, variant.id, 2);

    const res = await request(app)
      .post(`/api/dispatch-orders/${order.id}/confirm`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(Object.prototype.hasOwnProperty.call(res.body.items[0], "unitCostSnapshot")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body.items[0], "landedCostSnapshot")).toBe(false);
    expect(res.body.items[0].unitPrice).toBe("20"); // el precio de venta SÍ se ve
  });

  it("calcula y congela landedCostSnapshot = unitCostSnapshot + landedCostPerUnit prorrateado", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const variant = await createVariantWithIngreso({ productId: product.id, quantity: 10, unitCost: 10 });
    // Simula que el INGRESO ya traía flete/aduana prorrateados (landedCostPerUnit),
    // como pasaría vía POST /import-batches/:id/receive real.
    await prisma.inventoryMovement.updateMany({
      where: { variantId: variant.id, type: "INGRESO" },
      data: { landedCostPerUnit: 3 },
    });

    const order = await createPendingOrder(token, variant.id, 4);
    const res = await request(app)
      .post(`/api/dispatch-orders/${order.id}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.body.items[0].unitCostSnapshot).toBe("10");
    expect(res.body.items[0].landedCostSnapshot).toBe("13"); // 10 + 3
  });

  it("landedCostSnapshot queda congelado: un INGRESO posterior (más caro) no altera la orden ya confirmada", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const variant = await createVariantWithIngreso({ productId: product.id, quantity: 10, unitCost: 10 });
    await prisma.inventoryMovement.updateMany({
      where: { variantId: variant.id, type: "INGRESO" },
      data: { landedCostPerUnit: 2 },
    });

    const order = await createPendingOrder(token, variant.id, 4);
    const confirmed = await request(app)
      .post(`/api/dispatch-orders/${order.id}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(confirmed.body.items[0].landedCostSnapshot).toBe("12"); // 10 + 2

    // Llega un ingreso nuevo, mucho más caro, DESPUÉS de que la orden ya se confirmó.
    await prisma.inventoryMovement.create({
      data: {
        variantId: variant.id,
        type: "INGRESO",
        quantity: 10,
        unitCost: 100,
        landedCostPerUnit: 50,
        stockAfter: 16,
      },
    });

    const item = await prisma.dispatchOrderItem.findFirstOrThrow({ where: { dispatchOrderId: order.id } });
    expect(Number(item.landedCostSnapshot)).toBe(12); // sigue congelado, no se recalcula
  });
});

describe("POST /api/dispatch-orders/:id/cancel", () => {
  it("libera reservedStock y pasa a CANCELADO", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant(20);
    const finalCustomer = await createFinalCustomerFixture();

    const created = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send(
        orderBody({
          finalCustomerId: finalCustomer.id,
          items: [{ variantId: variant.id, quantity: 5, priceType: "PVP", unitPrice: 20 }],
        })
      );

    const res = await request(app)
      .post(`/api/dispatch-orders/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELADO");
    const updated = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updated.reservedStock).toBe(0);
    expect(updated.stock).toBe(20); // nunca salió stock real
  });

  it("rechaza cancelar una orden ya DESPACHADA", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant();
    const finalCustomer = await createFinalCustomerFixture();
    const created = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send(
        orderBody({
          finalCustomerId: finalCustomer.id,
          items: [{ variantId: variant.id, quantity: 1, priceType: "PVP", unitPrice: 10 }],
        })
      );
    await request(app)
      .post(`/api/dispatch-orders/${created.body.id}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    const res = await request(app)
      .post(`/api/dispatch-orders/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(409);
  });
});

describe("POST /api/dispatch-orders/:id/payments", () => {
  it("recalcula paymentStatus: PENDIENTE -> PARCIAL -> PAGADO", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant();
    const finalCustomer = await createFinalCustomerFixture();
    const created = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send(
        orderBody({
          finalCustomerId: finalCustomer.id,
          items: [{ variantId: variant.id, quantity: 2, priceType: "PVP", unitPrice: 50 }], // total = 100
        })
      );

    const partial = await request(app)
      .post(`/api/dispatch-orders/${created.body.id}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 40, method: "efectivo" });
    expect(partial.status).toBe(201);
    expect(partial.body.paymentStatus).toBe("PARCIAL");
    expect(partial.body.amountPaid).toBe("40");

    const full = await request(app)
      .post(`/api/dispatch-orders/${created.body.id}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 60, method: "transferencia" });
    expect(full.body.paymentStatus).toBe("PAGADO");
    expect(full.body.amountPaid).toBe("100");
  });

  it("acepta un pago que excede el total y lo topa en PAGADO", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant();
    const finalCustomer = await createFinalCustomerFixture();
    const created = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send(
        orderBody({
          finalCustomerId: finalCustomer.id,
          items: [{ variantId: variant.id, quantity: 1, priceType: "PVP", unitPrice: 50 }],
        })
      );

    const res = await request(app)
      .post(`/api/dispatch-orders/${created.body.id}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 70, method: "efectivo" });

    expect(res.status).toBe(201);
    expect(res.body.paymentStatus).toBe("PAGADO");
    expect(res.body.amountPaid).toBe("70"); // se guarda lo real, no se recorta a 50
  });
});

// Regresión específica: unitPrice ya viene NETO (con descuento aplicado,
// según la definición original del campo en schema.prisma). Si algún día se
// reintrodujera el bug de volver a aplicar discountPct sobre unitPrice, este
// test lo detecta — a propósito paga un monto que cae ENTRE el total
// correcto y el total "con descuento duplicado", para que las dos versiones
// del cálculo den un paymentStatus distinto y la aserción realmente discrimine.
describe("Regresión: discountPct no se vuelve a aplicar sobre unitPrice", () => {
  it("orderTotal, paymentStatus y dueDate son correctos con un ítem con discountPct > 0", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant();
    const wholesaler = await createWholesalerFixture({ defaultCreditDays: 15 });

    // unitPrice=40 (neto), discountPct=20 (solo informativo), quantity=3
    //   total CORRECTO (sin re-descontar):    40 × 3            = 120
    //   total si el bug estuviera presente:   40 × 0.8 × 3      = 96
    const created = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send(
        orderBody({
          buyerType: "MAYORISTA",
          wholesalerId: wholesaler.id,
          paymentMethod: "CREDITO",
          items: [
            { variantId: variant.id, quantity: 3, priceType: "MAYORISTA", unitPrice: 40, discountPct: 20 },
          ],
        })
      );
    expect(created.status).toBe(201);

    const confirmed = await request(app)
      .post(`/api/dispatch-orders/${created.body.id}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(confirmed.status).toBe(200);

    // dueDate = dispatchDate + 15 días, sin relación con discountPct — se
    // verifica en el mismo test para confirmar que nada de esto se rompió.
    const dispatchDate = new Date(confirmed.body.dispatchDate);
    const dueDate = new Date(confirmed.body.dueDate);
    const diffDays = Math.round((dueDate.getTime() - dispatchDate.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(15);

    // Pago de 100: está ENTRE 96 (total con bug) y 120 (total correcto).
    // Si el código estuviera usando el total correcto (120), 100 < 120 debe
    // dar PARCIAL. Si tuviera el bug (total 96), 100 >= 96 daría PAGADO —
    // por eso esta aserción cae distinto según cuál fórmula esté en uso.
    const payment = await request(app)
      .post(`/api/dispatch-orders/${created.body.id}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 100, method: "transferencia" });

    expect(payment.body.amountPaid).toBe("100");
    expect(payment.body.paymentStatus).toBe("PARCIAL"); // probaría PAGADO si el bug existiera

    // Completando hasta el total correcto (120) recién ahí debe dar PAGADO.
    const finalPayment = await request(app)
      .post(`/api/dispatch-orders/${created.body.id}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 20, method: "efectivo" });

    expect(finalPayment.body.amountPaid).toBe("120");
    expect(finalPayment.body.paymentStatus).toBe("PAGADO");
  });
});

describe("GET /api/accounts-receivable", () => {
  it("solo devuelve órdenes CREDITO vencidas y no pagadas totalmente", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupVariant();
    const wholesaler = await createWholesalerFixture({ defaultCreditDays: 30 });

    const created = await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send(
        orderBody({
          buyerType: "MAYORISTA",
          wholesalerId: wholesaler.id,
          paymentMethod: "CREDITO",
          items: [{ variantId: variant.id, quantity: 1, priceType: "MAYORISTA", unitPrice: 10 }],
        })
      );
    await request(app)
      .post(`/api/dispatch-orders/${created.body.id}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    // Forzamos que ya esté vencida (dueDate en el pasado) para no depender de
    // esperar 30 días reales en el test.
    await prisma.dispatchOrder.update({
      where: { id: created.body.id },
      data: { dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    const res = await request(app)
      .get("/api/accounts-receivable")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((o: { id: string }) => o.id)).toContain(created.body.id);
  });
});
