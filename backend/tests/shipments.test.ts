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
  it("marca RECHAZADO y aplica DEVOLUCION (el producto vuelve a stock)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant, shipmentId } = await setupConfirmedCodOrder(token, 5);

    const afterConfirm = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(afterConfirm.stock).toBe(15); // 20 - 5

    const res = await request(app)
      .post(`/api/shipments/${shipmentId}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rejectionReason: "Cliente no estaba en casa, no aceptó el paquete" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("RECHAZADO");

    const afterReject = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(afterReject.stock).toBe(20); // vuelve a los 20 originales

    const devolucion = await prisma.inventoryMovement.findFirst({
      where: { variantId: variant.id, type: "DEVOLUCION" },
    });
    expect(devolucion?.quantity).toBe(5);
    expect(devolucion?.stockAfter).toBe(20);
  });

  it("reutiliza el locationId del ítem (origen de la SALIDA) como destino de la DEVOLUCION", async () => {
    const { token } = await createTestUser("ADMIN");
    const location = await createLocationFixture();
    const { variant, shipmentId } = await setupConfirmedCodOrder(token, 5, 10, 25, location.id);

    const salida = await prisma.inventoryMovement.findFirst({
      where: { variantId: variant.id, type: "SALIDA" },
    });
    expect(salida?.fromLocationId).toBe(location.id);

    await request(app)
      .post(`/api/shipments/${shipmentId}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({ rejectionReason: "Cliente no estaba en casa" });

    const devolucion = await prisma.inventoryMovement.findFirst({
      where: { variantId: variant.id, type: "DEVOLUCION" },
    });
    expect(devolucion?.toLocationId).toBe(location.id);
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
