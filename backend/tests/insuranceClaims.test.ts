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

// Crea una orden CONTRA_ENTREGA, la confirma, y la marca PERDIDO/DANADO —
// dejando un InsuranceClaim PENDIENTE listo para resolve-customer/PATCH.
async function setupClaim(
  token: string,
  opts: {
    quantity?: number;
    unitCost?: number;
    unitPrice?: number;
    stock?: number;
    status?: "PERDIDO" | "DANADO";
  } = {}
) {
  const { quantity = 3, unitCost = 10, unitPrice = 25, stock = 20, status = "PERDIDO" } = opts;
  const { category } = await createCategoryFixture();
  const product = await createProductFixture({ categoryId: category.id });
  const variant = await createVariantWithIngreso({ productId: product.id, quantity: stock, unitCost });
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
      items: [{ variantId: variant.id, quantity, priceType: "PVP", unitPrice }],
    });

  const confirmed = await request(app)
    .post(`/api/dispatch-orders/${created.body.id}/confirm`)
    .set("Authorization", `Bearer ${token}`)
    .send({ courierId: courier.id });

  const shipmentId = confirmed.body.shipment.id;

  const lost = await request(app)
    .post(`/api/shipments/${shipmentId}/lost-or-damaged`)
    .set("Authorization", `Bearer ${token}`)
    .send({ status });

  return {
    variant,
    courier,
    originalOrderId: confirmed.body.id,
    claimId: lost.body.insuranceClaim.id,
    claimAmount: lost.body.insuranceClaim.claimAmount,
  };
}

async function payInFull(token: string, orderId: string, amount: number) {
  return request(app)
    .post(`/api/dispatch-orders/${orderId}/payments`)
    .set("Authorization", `Bearer ${token}`)
    .send({ amount, method: "transferencia" });
}

describe("POST /api/insurance-claims/:id/resolve-customer", () => {
  it("REPLACEMENT con la orden original ya PAGADO -> la nueva orden cobra 0 (codAmountExpected=0 al confirmarla)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { originalOrderId, claimId, claimAmount, courier } = await setupClaim(token, {
      quantity: 3,
      unitPrice: 25,
    });

    const paid = await payInFull(token, originalOrderId, Number(claimAmount));
    expect(paid.body.paymentStatus).toBe("PAGADO");

    const res = await request(app)
      .post(`/api/insurance-claims/${claimId}/resolve-customer`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolution: "REPLACEMENT" });

    expect(res.status).toBe(201);
    expect(res.body.insuranceClaim.customerResolution).toBe("REEMPLAZO");
    expect(res.body.replacementOrder.replacesOrderId).toBe(originalOrderId);
    expect(res.body.replacementOrder.paymentMethod).toBe("CONTRA_ENTREGA");
    expect(res.body.replacementOrder.items[0].unitPrice).toBe("0");

    const confirmedReplacement = await request(app)
      .post(`/api/dispatch-orders/${res.body.replacementOrder.id}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .send({ courierId: courier.id });

    expect(confirmedReplacement.status).toBe(200);
    expect(confirmedReplacement.body.shipment.codAmountExpected).toBe("0");
    // Mismo motivo que el test de overdue: varios round-trips reales a Neon
    // en cadena (setupClaim + pago + resolve-customer + confirm) — ya había
    // fallado una vez por timeout al filo de los 20000ms globales.
  }, 40000);

  it("REPLACEMENT con la orden original SIN pagar -> la nueva orden cobra el monto completo", async () => {
    const { token } = await createTestUser("ADMIN");
    const { originalOrderId, claimId, courier } = await setupClaim(token, { quantity: 3, unitPrice: 25 });

    const res = await request(app)
      .post(`/api/insurance-claims/${claimId}/resolve-customer`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolution: "REPLACEMENT" });

    expect(res.status).toBe(201);
    expect(res.body.replacementOrder.replacesOrderId).toBe(originalOrderId);
    expect(res.body.replacementOrder.items[0].unitPrice).toBe("25");
    expect(res.body.replacementOrder.items[0].quantity).toBe(3);

    const confirmedReplacement = await request(app)
      .post(`/api/dispatch-orders/${res.body.replacementOrder.id}/confirm`)
      .set("Authorization", `Bearer ${token}`)
      .send({ courierId: courier.id });

    expect(confirmedReplacement.status).toBe(200);
    expect(confirmedReplacement.body.shipment.codAmountExpected).toBe("75"); // 25 * 3
  });

  it("REPLACEMENT sin stock disponible -> 400, ninguna orden nueva se crea", async () => {
    const { token } = await createTestUser("ADMIN");
    // stock=3, quantity=3: el SALIDA de /confirm deja stock en 0 -> no queda
    // nada disponible para reservar la orden de reemplazo.
    const { claimId } = await setupClaim(token, { quantity: 3, stock: 3 });

    const ordersBefore = await prisma.dispatchOrder.count();

    const res = await request(app)
      .post(`/api/insurance-claims/${claimId}/resolve-customer`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolution: "REPLACEMENT" });

    expect(res.status).toBe(400);

    const ordersAfter = await prisma.dispatchOrder.count();
    expect(ordersAfter).toBe(ordersBefore); // ninguna orden de reemplazo quedó creada

    const claim = await prisma.insuranceClaim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claim.customerResolution).toBe("PENDIENTE"); // tampoco se actualizó el reclamo
  });

  it("REFUND parcial hace retroceder paymentStatus de PAGADO a PARCIAL", async () => {
    const { token } = await createTestUser("ADMIN");
    const { originalOrderId, claimId, claimAmount } = await setupClaim(token, { quantity: 3, unitPrice: 25 });
    await payInFull(token, originalOrderId, Number(claimAmount)); // orden -> PAGADO (75)

    const res = await request(app)
      .post(`/api/insurance-claims/${claimId}/resolve-customer`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolution: "REFUND", refundAmount: 30 });

    expect(res.status).toBe(201);
    expect(res.body.payment.amount).toBe("-30");
    expect(res.body.insuranceClaim.customerResolution).toBe("REEMBOLSO");
    expect(res.body.dispatchOrder.amountPaid).toBe("45"); // 75 - 30
    expect(res.body.dispatchOrder.paymentStatus).toBe("PARCIAL"); // retrocedió desde PAGADO
  });

  it("REFUND total hace retroceder paymentStatus de PAGADO a PENDIENTE", async () => {
    const { token } = await createTestUser("ADMIN");
    const { originalOrderId, claimId, claimAmount } = await setupClaim(token, { quantity: 3, unitPrice: 25 });
    await payInFull(token, originalOrderId, Number(claimAmount)); // orden -> PAGADO (75)

    const res = await request(app)
      .post(`/api/insurance-claims/${claimId}/resolve-customer`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolution: "REFUND", refundAmount: 75 });

    expect(res.status).toBe(201);
    expect(res.body.dispatchOrder.amountPaid).toBe("0");
    expect(res.body.dispatchOrder.paymentStatus).toBe("PENDIENTE");

    const payment = await prisma.payment.findFirstOrThrow({ where: { insuranceClaimId: claimId } });
    expect(payment.dispatchOrderId).toBe(originalOrderId);
    expect(Number(payment.amount)).toBe(-75);
  });

  it("400 si resolution=REFUND sin refundAmount", async () => {
    const { token } = await createTestUser("ADMIN");
    const { claimId } = await setupClaim(token);

    const res = await request(app)
      .post(`/api/insurance-claims/${claimId}/resolve-customer`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolution: "REFUND" });

    expect(res.status).toBe(400);
  });

  it("409 si la resolución con el cliente ya fue registrada", async () => {
    const { token } = await createTestUser("ADMIN");
    const { claimId } = await setupClaim(token, { quantity: 3, stock: 30 });

    const first = await request(app)
      .post(`/api/insurance-claims/${claimId}/resolve-customer`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolution: "REPLACEMENT" });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/insurance-claims/${claimId}/resolve-customer`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolution: "REFUND", refundAmount: 10 });

    expect(second.status).toBe(409);
  });

  it("solo ADMIN puede acceder", async () => {
    const { token } = await createTestUser("OPERATOR");
    const res = await request(app)
      .post("/api/insurance-claims/cualquier-id/resolve-customer")
      .set("Authorization", `Bearer ${token}`)
      .send({ resolution: "REPLACEMENT" });

    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/insurance-claims/:id", () => {
  it("actualiza status y reimbursedAmount", async () => {
    const { token } = await createTestUser("ADMIN");
    const { claimId } = await setupClaim(token);

    const res = await request(app)
      .patch(`/api/insurance-claims/${claimId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "PAGADO", reimbursedAmount: 75 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PAGADO");
    expect(res.body.reimbursedAmount).toBe("75");
    expect(res.body.resolvedDate).not.toBeNull();
  });

  it("solo ADMIN puede acceder", async () => {
    const { token } = await createTestUser("OPERATOR");
    const res = await request(app)
      .patch("/api/insurance-claims/cualquier-id")
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "PAGADO" });

    expect(res.status).toBe(403);
  });

  it("404 si el reclamo no existe", async () => {
    const { token } = await createTestUser("ADMIN");
    const res = await request(app)
      .patch("/api/insurance-claims/id-inexistente")
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "PAGADO" });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/insurance-claims", () => {
  it("overdue=true solo trae reclamos con expectedResolutionDate vencida y no cerrados", async () => {
    const { token } = await createTestUser("ADMIN");
    const { claimId: overdueOpenId } = await setupClaim(token);
    const { claimId: overdueClosedId } = await setupClaim(token);
    const { claimId: futureId } = await setupClaim(token);

    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.insuranceClaim.update({
      where: { id: overdueOpenId },
      data: { expectedResolutionDate: pastDate },
    });
    await prisma.insuranceClaim.update({
      where: { id: overdueClosedId },
      data: { expectedResolutionDate: pastDate, status: "PAGADO" },
    });
    // futureId se queda con su expectedResolutionDate = claimDate + 20 días (futura).

    const res = await request(app)
      .get("/api/insurance-claims")
      .query({ overdue: "true" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((c: { id: string }) => c.id);
    expect(ids).toContain(overdueOpenId);
    expect(ids).not.toContain(overdueClosedId); // vencido pero cerrado (PAGADO) -> excluido
    expect(ids).not.toContain(futureId); // no vencido todavía
    // 3x setupClaim (~8 round-trips reales a Neon cada uno) + 2 updates
    // directos ya venían quedando justo en el borde del testTimeout global
    // de 20000ms — no es flakiness, es presupuesto de tiempo insuficiente
    // para la cantidad real de round-trips secuenciales de este test puntual.
  }, 40000);

  it("agrega pendingByCourier (suma de claimAmount abierto, global, sin filtrar por la página actual)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { courier, claimAmount: amount1 } = await setupClaim(token, { quantity: 2, unitPrice: 25 }); // 50
    await setupClaim(token, { quantity: 1, unitPrice: 25 }); // otro courier distinto, 25

    const res = await request(app)
      .get("/api/insurance-claims")
      .query({ courierId: courier.id })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].claimAmount).toBe(amount1);

    // pendingByCourier es global: incluye AMBOS couriers, no solo el filtrado por courierId.
    expect(res.body.pendingByCourier.length).toBeGreaterThanOrEqual(2);
    const total = res.body.pendingByCourier.reduce(
      (sum: number, c: { totalPending: string }) => sum + Number(c.totalPending),
      0
    );
    expect(total).toBe(75); // 50 + 25
  });

  it("solo ADMIN puede acceder", async () => {
    const { token } = await createTestUser("OPERATOR");
    const res = await request(app).get("/api/insurance-claims").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
