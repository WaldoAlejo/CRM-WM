import fs from "fs";
import path from "path";
import request from "supertest";
import { afterEach, describe, expect, vi } from "vitest";
import { createApp } from "../src/app";
import { PRIVATE_UPLOADS_ROOT, UPLOADS_ROOT } from "../src/lib/upload";
import {
  createCategoryFixture,
  createProductFixture,
  createTestUser,
  createVariantWithIngreso,
  createWholesalerFixture,
  prisma,
  resetDatabase,
} from "./helpers";
import { it, settleInflight } from "./inflight";

const app = createApp();
vi.setConfig({ testTimeout: 60000 });

const createdOrderIds: string[] = [];

afterEach(async () => {
  await settleInflight(); // nunca truncar mientras el cuerpo de un test sigue corriendo
  // Los comprobantes de prueba se escriben en disco real (uploads-private/): se limpian.
  for (const id of createdOrderIds.splice(0)) {
    fs.rmSync(path.join(PRIVATE_UPLOADS_ROOT, "payments", id), { recursive: true, force: true });
  }
  await resetDatabase();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
// PNG mínimo válido (1x1).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

// Orden CREDITO ya confirmada (total 5 × $20 = $100).
async function createCreditOrder(token: string) {
  const { category } = await createCategoryFixture();
  const product = await createProductFixture({ categoryId: category.id });
  const variant = await createVariantWithIngreso({ productId: product.id, quantity: 20, unitCost: 10 });
  const wholesaler = await createWholesalerFixture({ defaultCreditDays: 30 });
  const created = await request(app)
    .post("/api/dispatch-orders")
    .set(auth(token))
    .send({
      buyerType: "MAYORISTA",
      wholesalerId: wholesaler.id,
      shippingProvince: "Guayas",
      shippingCity: "Guayaquil",
      paymentMethod: "CREDITO",
      items: [{ variantId: variant.id, quantity: 5, priceType: "MAYORISTA", unitPrice: 20 }],
    });
  await request(app).post(`/api/dispatch-orders/${created.body.id}/confirm`).set(auth(token)).send({});
  createdOrderIds.push(created.body.id);
  return created.body.id as string;
}

function payWithProof(token: string, orderId: string, amount = 40, file: Buffer = PNG, contentType = "image/png", filename = "comprobante.png") {
  return request(app)
    .post(`/api/dispatch-orders/${orderId}/payments`)
    .set(auth(token))
    .field("amount", String(amount))
    .field("method", "transferencia")
    .field("notes", "Transferencia Banco Pichincha")
    .attach("proof", file, { filename, contentType });
}

const proofDir = (orderId: string) => path.join(PRIVATE_UPLOADS_ROOT, "payments", orderId);

describe("Comprobante de pago — registrar con y sin foto", () => {
  it("con foto: guarda el pago, deja el archivo en el almacenamiento PRIVADO y actualiza el saldo", async () => {
    const admin = await createTestUser("ADMIN");
    const orderId = await createCreditOrder(admin.token);

    const res = await payWithProof(admin.token, orderId, 40);
    expect(res.status).toBe(201);
    expect(res.body.paymentStatus).toBe("PARCIAL");
    expect(Number(res.body.amountPaid)).toBe(40);

    const payment = await prisma.payment.findFirstOrThrow({ where: { dispatchOrderId: orderId } });
    expect(payment.proofFile).toMatch(new RegExp(`^payments/${orderId}/[0-9a-f-]+\\.png$`));
    expect(fs.existsSync(path.join(PRIVATE_UPLOADS_ROOT, payment.proofFile!))).toBe(true);
    // Nunca queda en la carpeta PÚBLICA (servida sin autenticación).
    expect(fs.existsSync(path.join(UPLOADS_ROOT, "payments"))).toBe(false);
  });

  it("sin foto (JSON, como siempre): el comprobante es opcional", async () => {
    const admin = await createTestUser("ADMIN");
    const orderId = await createCreditOrder(admin.token);

    const res = await request(app)
      .post(`/api/dispatch-orders/${orderId}/payments`)
      .set(auth(admin.token))
      .send({ amount: 100, method: "efectivo" });
    expect(res.status).toBe(201);
    expect(res.body.paymentStatus).toBe("PAGADO");

    const payment = await prisma.payment.findFirstOrThrow({ where: { dispatchOrderId: orderId } });
    expect(payment.proofFile).toBeNull();
    expect(fs.existsSync(proofDir(orderId))).toBe(false);

    const proof = await request(app).get(`/api/dispatch-orders/${orderId}/payments/${payment.id}/proof`).set(auth(admin.token));
    expect(proof.status).toBe(404);

    // Multipart SIN archivo también es válido.
    const orderId2 = await createCreditOrder(admin.token);
    const multipartNoFile = await request(app)
      .post(`/api/dispatch-orders/${orderId2}/payments`)
      .set(auth(admin.token))
      .field("amount", "10")
      .field("method", "efectivo");
    expect(multipartNoFile.status).toBe(201);
  });

  it("rechaza tipos que no son imagen (400) sin registrar el pago ni dejar archivos", async () => {
    const admin = await createTestUser("ADMIN");
    const orderId = await createCreditOrder(admin.token);

    const res = await payWithProof(admin.token, orderId, 40, Buffer.from("no soy una imagen"), "text/plain", "x.txt");
    expect(res.status).toBe(400);
    expect(await prisma.payment.count({ where: { dispatchOrderId: orderId } })).toBe(0);
    expect(fs.existsSync(proofDir(orderId)) ? fs.readdirSync(proofDir(orderId)) : []).toEqual([]);
  });

  it("si el pago es inválido (monto 0) la foto recién subida se descarta: no queda un comprobante huérfano", async () => {
    const admin = await createTestUser("ADMIN");
    const orderId = await createCreditOrder(admin.token);

    const res = await payWithProof(admin.token, orderId, 0);
    expect(res.status).toBe(400);
    expect(await prisma.payment.count({ where: { dispatchOrderId: orderId } })).toBe(0);
    // unlink es asíncrono: se espera un instante a que termine.
    await vi.waitFor(() => expect(fs.existsSync(proofDir(orderId)) ? fs.readdirSync(proofDir(orderId)) : []).toEqual([]));
  });

  it("orden inexistente: 404 y NO se crea ninguna carpeta con el id arbitrario de la URL", async () => {
    const admin = await createTestUser("ADMIN");
    const res = await payWithProof(admin.token, "orden-que-no-existe");
    expect(res.status).toBe(404);
    expect(fs.existsSync(proofDir("orden-que-no-existe"))).toBe(false);
  });
});

describe("Comprobante de pago — quién lo ve", () => {
  it("ADMIN y CEO ven que hay comprobante y lo descargan por el endpoint autenticado; la ruta interna nunca sale", async () => {
    const admin = await createTestUser("ADMIN");
    const ceo = await createTestUser("CEO");
    const orderId = await createCreditOrder(admin.token);
    await payWithProof(admin.token, orderId);
    const payment = await prisma.payment.findFirstOrThrow({ where: { dispatchOrderId: orderId } });

    for (const who of [admin, ceo]) {
      const detail = await request(app).get(`/api/dispatch-orders/${orderId}`).set(auth(who.token));
      expect(detail.body.payments[0].hasProof).toBe(true);
      expect(JSON.stringify(detail.body)).not.toContain("proofFile");
      expect(JSON.stringify(detail.body)).not.toContain("uploads-private");

      const file = await request(app)
        .get(`/api/dispatch-orders/${orderId}/payments/${payment.id}/proof`)
        .set(auth(who.token))
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      expect(file.status).toBe(200);
      expect(file.headers["content-type"]).toMatch(/image\/png/);
      expect(file.headers["cache-control"]).toMatch(/private/);
      expect(file.headers["x-content-type-options"]).toBe("nosniff");
      expect(Buffer.compare(file.body as Buffer, PNG)).toBe(0);
    }
  });

  it("OPERATOR ve el pago (monto, método) como hoy, pero NO el comprobante: ni la marca ni la imagen; y no puede registrar pagos ni subir archivos", async () => {
    const admin = await createTestUser("ADMIN");
    const operator = await createTestUser("OPERATOR");
    const orderId = await createCreditOrder(admin.token);
    await payWithProof(admin.token, orderId);
    const payment = await prisma.payment.findFirstOrThrow({ where: { dispatchOrderId: orderId } });

    const detail = await request(app).get(`/api/dispatch-orders/${orderId}`).set(auth(operator.token));
    expect(detail.status).toBe(200);
    expect(Number(detail.body.payments[0].amount)).toBe(40);
    expect(detail.body.payments[0].method).toBe("transferencia");
    expect("hasProof" in detail.body.payments[0]).toBe(false);
    expect("proofFile" in detail.body.payments[0]).toBe(false);

    const file = await request(app).get(`/api/dispatch-orders/${orderId}/payments/${payment.id}/proof`).set(auth(operator.token));
    expect(file.status).toBe(403);

    // OPERATOR no llega a subir nada: 403 ANTES de que multer escriba el archivo.
    const orderId2 = await createCreditOrder(admin.token);
    const upload = await payWithProof(operator.token, orderId2);
    expect(upload.status).toBe(403);
    expect(fs.existsSync(proofDir(orderId2))).toBe(false);
    expect(await prisma.payment.count({ where: { dispatchOrderId: orderId2 } })).toBe(0);

    // Sin token, tampoco.
    expect((await request(app).get(`/api/dispatch-orders/${orderId}/payments/${payment.id}/proof`)).status).toBe(401);
  });

  it("el comprobante de un pago no se puede pedir a través de OTRA orden, ni por ninguna URL estática", async () => {
    const admin = await createTestUser("ADMIN");
    const orderA = await createCreditOrder(admin.token);
    const orderB = await createCreditOrder(admin.token);
    await payWithProof(admin.token, orderA);
    const payment = await prisma.payment.findFirstOrThrow({ where: { dispatchOrderId: orderA } });

    const cross = await request(app).get(`/api/dispatch-orders/${orderB}/payments/${payment.id}/proof`).set(auth(admin.token));
    expect(cross.status).toBe(404);

    // No hay forma de llegar al archivo sin autenticación por rutas estáticas.
    expect((await request(app).get(`/${payment.proofFile}`)).status).toBe(404);
    expect((await request(app).get(`/uploads/${payment.proofFile}`)).status).toBe(404);
    expect((await request(app).get(`/uploads-private/${payment.proofFile}`)).status).toBe(404);
  });
});

describe("Ledger append-only: un pago (y su comprobante) no se edita ni se borra", () => {
  it("PATCH / PUT / DELETE sobre un pago ya registrado fallan (405) para ADMIN y CEO, y todo queda intacto", async () => {
    const admin = await createTestUser("ADMIN");
    const ceo = await createTestUser("CEO");
    const orderId = await createCreditOrder(admin.token);
    await payWithProof(admin.token, orderId, 40);
    const payment = await prisma.payment.findFirstOrThrow({ where: { dispatchOrderId: orderId } });
    const url = `/api/dispatch-orders/${orderId}/payments/${payment.id}`;

    for (const who of [admin, ceo]) {
      const patch = await request(app).patch(url).set(auth(who.token)).send({ amount: 1 });
      const put = await request(app).put(url).set(auth(who.token)).send({ amount: 1, method: "x" });
      const del = await request(app).delete(url).set(auth(who.token));
      expect([patch.status, put.status, del.status]).toEqual([405, 405, 405]);
      expect(patch.body.error).toMatch(/append-only|no se pueden editar/i);
    }

    // Tampoco existe forma de cambiar/borrar el comprobante por su propia URL.
    const proofUrl = `${url}/proof`;
    for (const method of ["patch", "put", "delete", "post"] as const) {
      const res = await request(app)[method](proofUrl).set(auth(admin.token)).send({});
      expect([404, 405], method).toContain(res.status);
    }

    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(Number(after.amount)).toBe(40);
    expect(after.method).toBe("transferencia");
    expect(after.proofFile).toBe(payment.proofFile);
    expect(fs.existsSync(path.join(PRIVATE_UPLOADS_ROOT, after.proofFile!))).toBe(true);
    expect(await prisma.payment.count({ where: { dispatchOrderId: orderId } })).toBe(1);
  });

  it("corregir se hace registrando un pago NUEVO, no editando el original", async () => {
    const admin = await createTestUser("ADMIN");
    const orderId = await createCreditOrder(admin.token);
    await payWithProof(admin.token, orderId, 40);
    // La API exige monto > 0: el saldo se completa con otro pago; el original no se toca.
    await request(app).post(`/api/dispatch-orders/${orderId}/payments`).set(auth(admin.token)).send({ amount: 60, method: "transferencia" });
    expect(await prisma.payment.count({ where: { dispatchOrderId: orderId } })).toBe(2);
    expect((await prisma.dispatchOrder.findUniqueOrThrow({ where: { id: orderId } })).paymentStatus).toBe("PAGADO");
  });
});
