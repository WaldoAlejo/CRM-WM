import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import {
  createCategoryFixture,
  createCourierFixture,
  createFinalCustomerFixture,
  createLocationFixture,
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

// Crea una orden CONTRA_ENTREGA ya confirmada (con su Shipment EN_TRANSITO),
// lista para probar los 3 escenarios del courier.
async function setupConfirmedCodOrder(
  token: string,
  quantity = 5,
  unitCost = 10,
  unitPrice = 25,
  locationId?: string
) {
  const { category } = await createCategoryFixture();
  const product = await createProductFixture({ categoryId: category.id });
  const variant = await createVariantWithIngreso({ productId: product.id, quantity: 20, unitCost });
  const finalCustomer = await createFinalCustomerFixture();
  const courier = await createCourierFixture();

  const created = await request(app)
    .post("/api/dispatch-orders")
    .set("Authorization", `Bearer ${token}`)
    .send({
      buyerType: "CLIENTE_FINAL",
      finalCustomerId: finalCustomer.id,
      shippingProvince: "Pichincha",
      shippingCity: "Quito",
      paymentMethod: "CONTRA_ENTREGA",
      items: [{ variantId: variant.id, quantity, priceType: "PVP", unitPrice, locationId }],
    });

  const confirmed = await request(app)
    .post(`/api/dispatch-orders/${created.body.id}/confirm`)
    .set("Authorization", `Bearer ${token}`)
    .send({ courierId: courier.id });

  return { variant, order: confirmed.body, shipmentId: confirmed.body.shipment.id };
}

describe("POST /api/shipments/:id/deliver", () => {
  it("marca ENTREGADO y crea un Payment que actualiza paymentStatus", async () => {
    const { token } = await createTestUser("ADMIN");
    const { order, shipmentId } = await setupConfirmedCodOrder(token, 2, 10, 25); // total = 50

    const res = await request(app)
      .post(`/api/shipments/${shipmentId}/deliver`)
      .set("Authorization", `Bearer ${token}`)
      .send({ codAmountCollected: 50 });

    expect(res.status).toBe(200);
    expect(res.body.shipment.status).toBe("ENTREGADO");
    expect(res.body.dispatchOrder.paymentStatus).toBe("PAGADO");
    expect(res.body.dispatchOrder.amountPaid).toBe("50");

    const payment = await prisma.payment.findFirst({ where: { dispatchOrderId: order.id } });
    expect(payment?.method).toBe("cobro courier");
    expect(Number(payment?.amount)).toBe(50);
  });

  it("cobro parcial contra entrega recalcula paymentStatus=PARCIAL (no solo el camino feliz de PAGADO)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { order, shipmentId } = await setupConfirmedCodOrder(token, 2, 10, 25); // total = 50

    const res = await request(app)
      .post(`/api/shipments/${shipmentId}/deliver`)
      .set("Authorization", `Bearer ${token}`)
      .send({ codAmountCollected: 30 }); // el courier solo logró cobrar 30 de 50

    expect(res.status).toBe(200);
    expect(res.body.shipment.status).toBe("ENTREGADO");
    expect(res.body.shipment.codAmountCollected).toBe("30");
    expect(res.body.dispatchOrder.paymentStatus).toBe("PARCIAL");
    expect(res.body.dispatchOrder.amountPaid).toBe("30");

    const payment = await prisma.payment.findFirst({ where: { dispatchOrderId: order.id } });
    expect(Number(payment?.amount)).toBe(30);
  });

  it("rechaza entregar un shipment que no está EN_TRANSITO", async () => {
    const { token } = await createTestUser("ADMIN");
    const { shipmentId } = await setupConfirmedCodOrder(token);

    await request(app)
      .post(`/api/shipments/${shipmentId}/deliver`)
      .set("Authorization", `Bearer ${token}`)
      .send({ codAmountCollected: 999 });

    const res = await request(app)
      .post(`/api/shipments/${shipmentId}/deliver`)
      .set("Authorization", `Bearer ${token}`)
      .send({ codAmountCollected: 999 });

    expect(res.status).toBe(409);
  });
});

describe("POST /api/shipments/:id/reject", () => {
  it("marca RECHAZADO pero NO devuelve stock todavía: las unidades quedan pendientes de checklist en Cuarentena", async () => {
    const { token } = await createTestUser("ADMIN");
    const location = await createLocationFixture();
    const { variant, shipmentId } = await setupConfirmedCodOrder(token, 5, 10, 25, location.id);

    const afterConfirm = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(afterConfirm.stock).toBe(15); // 20 - 5

    const res = await request(app)
      .post(`/api/shipments/${shipmentId}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rejectionReason: "Cliente no estaba en casa, no aceptó el paquete" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("RECHAZADO");

    // Ya no hay DEVOLUCION directa: el stock sigue en 15 hasta que pase el checklist.
    const afterReject = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(afterReject.stock).toBe(15);
    expect(await prisma.inventoryMovement.count({ where: { variantId: variant.id, type: "DEVOLUCION" } })).toBe(0);

    const batch = await prisma.returnBatch.findUniqueOrThrow({
      where: { shipmentId },
      include: { lines: { include: { quarantineLocation: true } } },
    });
    expect(batch.source).toBe("COURIER_RECHAZADO");
    expect(batch.completedAt).toBeNull();
    expect(batch.lines).toHaveLength(1);
    expect(batch.lines[0].quantity).toBe(5);
    expect(batch.lines[0].originLocationId).toBe(location.id);
    expect(batch.lines[0].quarantineLocation?.type).toBe("CUARENTENA");
  });

  it("checklist que PASA: DEVOLUCION a la MISMA ubicación de la SALIDA, con referencia a ese movimiento", async () => {
    const { token } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const location = await createLocationFixture();
    const { variant, shipmentId } = await setupConfirmedCodOrder(token, 5, 10, 25, location.id);

    const salida = await prisma.inventoryMovement.findFirstOrThrow({ where: { variantId: variant.id, type: "SALIDA" } });
    expect(salida.fromLocationId).toBe(location.id);

    await request(app)
      .post(`/api/shipments/${shipmentId}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rejectionReason: "Cliente no estaba en casa" });

    const line = await prisma.returnLine.findFirstOrThrow({ where: { batch: { shipmentId } } });
    const res = await request(app)
      .post(`/api/quarantine/lines/${line.id}/inspections`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ quantity: 5, boxOk: true, noVisibleDamage: true, piecesComplete: true });
    expect(res.status).toBe(201);
    expect(res.body.inspection.result).toBe("PASA");
    expect(res.body.batchCompleted).toBe(true);
    expect(res.body.chargeGenerated).toBe(false);

    const devolucion = await prisma.inventoryMovement.findFirstOrThrow({ where: { variantId: variant.id, type: "DEVOLUCION" } });
    expect(devolucion.quantity).toBe(5);
    expect(devolucion.stockAfter).toBe(20);
    expect(devolucion.toLocationId).toBe(location.id);
    expect(devolucion.originMovementId).toBe(salida.id);
    expect(await prisma.insuranceClaim.count({ where: { shipmentId } })).toBe(0);
  });

  it("checklist que NO PASA: no vuelve stock y el courier debe el valor de venta (InsuranceClaim = unitPrice × cantidad)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const location = await createLocationFixture();
    const { variant, shipmentId } = await setupConfirmedCodOrder(token, 4, 10, 25, location.id);

    await request(app)
      .post(`/api/shipments/${shipmentId}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rejectionReason: "Cliente no estaba en casa" });

    const line = await prisma.returnLine.findFirstOrThrow({ where: { batch: { shipmentId } } });
    const res = await request(app)
      .post(`/api/quarantine/lines/${line.id}/inspections`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ quantity: 4, boxOk: true, noVisibleDamage: false, piecesComplete: true, observation: "Golpe en una esquina" });
    expect(res.status).toBe(201);
    expect(res.body.inspection.result).toBe("NO_PASA");
    expect(res.body.chargeGenerated).toBe(true);

    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock).toBe(16);
    expect(await prisma.inventoryMovement.count({ where: { variantId: variant.id, type: "DEVOLUCION" } })).toBe(0);

    const claim = await prisma.insuranceClaim.findUniqueOrThrow({ where: { shipmentId } });
    expect(Number(claim.claimAmount)).toBe(100); // 4 × 25, igual que perdido/dañado
    expect(claim.status).toBe("PENDIENTE");
  });

  it("rechaza reject sin rejectionReason", async () => {
    const { token } = await createTestUser("ADMIN");
    const { shipmentId } = await setupConfirmedCodOrder(token);

    const res = await request(app)
      .post(`/api/shipments/${shipmentId}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe("POST /api/shipments/:id/lost-or-damaged", () => {
  it("NO crea ningún InventoryMovement y NO vuelve a restar stock (Hallazgo 2)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant, shipmentId } = await setupConfirmedCodOrder(token, 5, 10);

    const afterConfirm = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(afterConfirm.stock).toBe(15); // 20 - 5, ya restado por el SALIDA de /confirm

    const res = await request(app)
      .post(`/api/shipments/${shipmentId}/lost-or-damaged`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "PERDIDO" });

    expect(res.status).toBe(200);
    expect(res.body.shipment.status).toBe("PERDIDO");

    // El punto central del Hallazgo 2: el stock NO vuelve a bajar.
    const afterLoss = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(afterLoss.stock).toBe(15); // sigue en 15, no en 10

    const siniestroCount = await prisma.inventoryMovement.count({
      where: { variantId: variant.id, type: "SINIESTRO" },
    });
    expect(siniestroCount).toBe(0);

    // El único movimiento de esta variante sigue siendo el SALIDA de /confirm
    // (más el INGRESO inicial del fixture) — nada más.
    const allMovements = await prisma.inventoryMovement.findMany({ where: { variantId: variant.id } });
    expect(allMovements.map((m) => m.type).sort()).toEqual(["INGRESO", "SALIDA"]);
  });

  it("crea un InsuranceClaim con claimAmount = unitPrice × quantity (precio de venta, no costo)", async () => {
    const { token } = await createTestUser("ADMIN");
    // unitCost=12 (costo, irrelevante acá), unitPrice=25 (default del helper), quantity=3
    const { shipmentId } = await setupConfirmedCodOrder(token, 3, 12);

    const res = await request(app)
      .post(`/api/shipments/${shipmentId}/lost-or-damaged`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "DANADO" });

    expect(res.status).toBe(200);
    expect(res.body.shipment.status).toBe("DANADO");
    expect(res.body.insuranceClaim.claimAmount).toBe("75"); // 25 * 3, precio de venta
    expect(res.body.insuranceClaim.status).toBe("PENDIENTE");
    expect(res.body.insuranceClaim.customerResolution).toBe("PENDIENTE");

    const claim = await prisma.insuranceClaim.findUniqueOrThrow({ where: { id: res.body.insuranceClaim.id } });
    const diffDays = Math.round(
      (claim.expectedResolutionDate.getTime() - claim.claimDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    expect(diffDays).toBe(20);
  });

  it("NO-REGRESIÓN con Cuarentena: PERDIDO/DANADO sigue exactamente igual (claim al instante, sin lote de devolución ni checklist)", async () => {
    const { token } = await createTestUser("ADMIN");
    const location = await createLocationFixture();

    for (const status of ["PERDIDO", "DANADO"] as const) {
      const { variant, shipmentId } = await setupConfirmedCodOrder(token, 3, 10, 25, location.id);
      const before = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });

      const res = await request(app)
        .post(`/api/shipments/${shipmentId}/lost-or-damaged`)
        .set("Authorization", `Bearer ${token}`)
        .send({ status });
      expect(res.status, status).toBe(200);
      expect(res.body.shipment.status, status).toBe(status);

      // El claim se crea de inmediato (sin esperar ningún checklist), por el precio de venta.
      expect(Number(res.body.insuranceClaim.claimAmount), status).toBe(75); // 3 × 25
      expect(res.body.insuranceClaim.status, status).toBe("PENDIENTE");

      // Nada de Cuarentena: ni lote de devolución, ni stock movido.
      expect(await prisma.returnBatch.count({ where: { shipmentId } }), status).toBe(0);
      const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(after.stock, status).toBe(before.stock);
      expect(await prisma.inventoryMovement.count({ where: { variantId: variant.id, type: { in: ["DEVOLUCION", "SINIESTRO"] } } }), status).toBe(0);
    }
  });

  it("rechaza un status distinto a PERDIDO/DANADO", async () => {
    const { token } = await createTestUser("ADMIN");
    const { shipmentId } = await setupConfirmedCodOrder(token);

    const res = await request(app)
      .post(`/api/shipments/${shipmentId}/lost-or-damaged`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "ENTREGADO" });

    expect(res.status).toBe(400);
  });

  it("rechaza si el shipment no está EN_TRANSITO", async () => {
    const { token } = await createTestUser("ADMIN");
    const { shipmentId } = await setupConfirmedCodOrder(token);

    await request(app)
      .post(`/api/shipments/${shipmentId}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rejectionReason: "test" });

    const res = await request(app)
      .post(`/api/shipments/${shipmentId}/lost-or-damaged`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "PERDIDO" });

    expect(res.status).toBe(409);
  });
});

describe("Monto del reclamo al courier: siempre el valor FACTURADO (unitPrice de la orden), nunca un PVP de lista", () => {
  it("perdido/dañado y rechazado-no-conforme dan exactamente el mismo monto para la misma orden, y no usan PVP ni mayorista de lista", async () => {
    const { token } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const location = await createLocationFixture();
    const INVOICED_UNIT_PRICE = 19.99; // lo realmente facturado en la orden
    const QTY = 3; // 3 × 19.99 = 59.97

    // Dos órdenes idénticas; en ambas la variante tiene un PVP y un mayorista de
    // lista MUY distintos del precio facturado: si algún cálculo los usara, no daría 59.97.
    async function orderWithDistinctListPrices() {
      const setup = await setupConfirmedCodOrder(token, QTY, 10, INVOICED_UNIT_PRICE, location.id);
      await prisma.productVariant.update({
        where: { id: setup.variant.id },
        data: { retailPrice: 99, wholesalePrice: 50, retailDiscountPct: 5 },
      });
      return setup;
    }

    // Caso 1: perdido/dañado.
    const lost = await orderWithDistinctListPrices();
    const lostRes = await request(app)
      .post(`/api/shipments/${lost.shipmentId}/lost-or-damaged`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "DANADO" });
    expect(lostRes.status).toBe(200);

    // Caso 2: rechazado y NO pasa el checklist.
    const rejected = await orderWithDistinctListPrices();
    await request(app)
      .post(`/api/shipments/${rejected.shipmentId}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rejectionReason: "Cliente no estaba en casa" });
    const line = await prisma.returnLine.findFirstOrThrow({ where: { batch: { shipmentId: rejected.shipmentId } } });
    // El precio de la línea de devolución es el de la orden, congelado al rechazar.
    expect(Number(line.unitPrice)).toBe(INVOICED_UNIT_PRICE);
    await request(app)
      .post(`/api/quarantine/lines/${line.id}/inspections`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ quantity: QTY, boxOk: true, noVisibleDamage: false, piecesComplete: true });

    const lostClaim = await prisma.insuranceClaim.findUniqueOrThrow({ where: { shipmentId: lost.shipmentId } });
    const rejectedClaim = await prisma.insuranceClaim.findUniqueOrThrow({ where: { shipmentId: rejected.shipmentId } });

    expect(lostClaim.claimAmount.toString()).toBe("59.97");
    expect(rejectedClaim.claimAmount.toString()).toBe("59.97");
    expect(rejectedClaim.claimAmount.equals(lostClaim.claimAmount)).toBe(true);
    // Y coincide con el total de la orden (el valor de la factura), no con el PVP (3 × 99) ni el mayorista (3 × 50).
    const orderTotal = await request(app).get(`/api/dispatch-orders/${rejected.order.id}`).set("Authorization", `Bearer ${token}`);
    const invoiced = orderTotal.body.items.reduce(
      (sum: number, i: { unitPrice: string; quantity: number }) => sum + Number(i.unitPrice) * i.quantity,
      0
    );
    expect(invoiced.toFixed(2)).toBe("59.97");
  });

  it("rechazado con checklist dividido: el reclamo cubre solo las unidades que no pasaron, al precio facturado", async () => {
    const { token } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const location = await createLocationFixture();
    const { shipmentId } = await setupConfirmedCodOrder(token, 5, 10, 19.99, location.id);
    await request(app)
      .post(`/api/shipments/${shipmentId}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rejectionReason: "Cliente no estaba en casa" });
    const line = await prisma.returnLine.findFirstOrThrow({ where: { batch: { shipmentId } } });
    const inspect = (body: Record<string, unknown>) =>
      request(app).post(`/api/quarantine/lines/${line.id}/inspections`).set("Authorization", `Bearer ${operatorToken}`).send(body);

    await inspect({ quantity: 3, boxOk: true, noVisibleDamage: true, piecesComplete: true });
    await inspect({ quantity: 2, boxOk: true, noVisibleDamage: true, piecesComplete: false });

    const claim = await prisma.insuranceClaim.findUniqueOrThrow({ where: { shipmentId } });
    expect(claim.claimAmount.toString()).toBe("39.98"); // 2 × 19.99
  });
});
