import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import {
  createCategoryFixture,
  createImportBatchFixture,
  createProductFixture,
  createSupplierFixture,
  createTestUser,
  createVariantFixture,
  prisma,
  resetDatabase,
} from "./helpers";

const app = createApp();

afterEach(async () => {
  await resetDatabase();
});

async function setupProductWithVariant(initialStock = 0) {
  const { category } = await createCategoryFixture();
  const product = await createProductFixture({ categoryId: category.id });
  const variant = await createVariantFixture({ productId: product.id, stock: initialStock });
  return { product, variant };
}

describe("POST /api/import-batches", () => {
  it("crea un lote de importación", async () => {
    const { token } = await createTestUser("ADMIN");
    const supplier = await createSupplierFixture();

    const res = await request(app)
      .post("/api/import-batches")
      .set("Authorization", `Bearer ${token}`)
      .send({
        reference: "CONT-TEST-001",
        supplierId: supplier.id,
        arrivalDate: "2026-09-20",
        freightCost: 850,
        customsCost: 1200,
        otherCosts: 150,
      });

    expect(res.status).toBe(201);
    expect(res.body.reference).toBe("CONT-TEST-001");
    expect(res.body.freightCost).toBe("850");
  });

  it("OPERATOR recibe 403 si incluye campos de costo", async () => {
    const { token } = await createTestUser("OPERATOR");

    const res = await request(app)
      .post("/api/import-batches")
      .set("Authorization", `Bearer ${token}`)
      .send({ reference: "CONT-TEST-002", arrivalDate: "2026-09-20", freightCost: 100 });

    expect(res.status).toBe(403);
  });

  it("OPERATOR puede crear un lote sin campos de costo", async () => {
    const { token } = await createTestUser("OPERATOR");

    const res = await request(app)
      .post("/api/import-batches")
      .set("Authorization", `Bearer ${token}`)
      .send({ reference: "CONT-TEST-003", arrivalDate: "2026-09-20" });

    expect(res.status).toBe(201);
  });
});

describe("GET /api/import-batches", () => {
  it("oculta los costos para OPERATOR y los muestra para ADMIN", async () => {
    const { token: adminToken } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    await prisma.importBatch.create({
      data: {
        reference: "CONT-LIST-001",
        arrivalDate: new Date(),
        freightCost: 500,
        customsCost: 300,
        otherCosts: 50,
      },
    });

    const asAdmin = await request(app).get("/api/import-batches").set("Authorization", `Bearer ${adminToken}`);
    const asOperator = await request(app)
      .get("/api/import-batches")
      .set("Authorization", `Bearer ${operatorToken}`);

    expect(asAdmin.body.data[0].freightCost).toBe("500");
    expect(Object.prototype.hasOwnProperty.call(asOperator.body.data[0], "freightCost")).toBe(false);
  });
});

describe("POST /api/import-batches/:id/receive", () => {
  it("crea un InventoryMovement INGRESO por línea y suma el stock cacheado", async () => {
    const { token, user } = await createTestUser("ADMIN");
    const { variant: variantA } = await setupProductWithVariant(10);
    const { variant: variantB } = await setupProductWithVariant(5);
    const batch = await createImportBatchFixture();

    const res = await request(app)
      .post(`/api/import-batches/${batch.id}/receive`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        lines: [
          { variantId: variantA.id, quantity: 20, unitCost: 22.5 },
          { variantId: variantB.id, quantity: 15, unitCost: 27 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.movements).toHaveLength(2);

    const updatedA = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantA.id } });
    const updatedB = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantB.id } });
    expect(updatedA.stock).toBe(30); // 10 + 20
    expect(updatedB.stock).toBe(20); // 5 + 15

    const movements = await prisma.inventoryMovement.findMany({ where: { importBatchId: batch.id } });
    expect(movements).toHaveLength(2);
    expect(movements.every((m) => m.type === "INGRESO")).toBe(true);
    expect(movements.every((m) => m.createdById === user.id)).toBe(true);
  });

  it("OPERATOR puede recibir mercadería incluyendo unitCost", async () => {
    const { token } = await createTestUser("OPERATOR");
    const { variant } = await setupProductWithVariant();
    const batch = await createImportBatchFixture();

    const res = await request(app)
      .post(`/api/import-batches/${batch.id}/receive`)
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [{ variantId: variant.id, quantity: 10, unitCost: 15 }] });

    expect(res.status).toBe(201);
  });

  it("rechaza cantidad <= 0", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupProductWithVariant();
    const batch = await createImportBatchFixture();

    const res = await request(app)
      .post(`/api/import-batches/${batch.id}/receive`)
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [{ variantId: variant.id, quantity: 0, unitCost: 10 }] });

    expect(res.status).toBe(400);
  });

  it("es atómico: si UNA línea tiene un variantId inexistente, NINGUNA se aplica", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupProductWithVariant(10);
    const batch = await createImportBatchFixture();

    const res = await request(app)
      .post(`/api/import-batches/${batch.id}/receive`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        lines: [
          { variantId: variant.id, quantity: 20, unitCost: 22.5 },
          { variantId: "id-que-no-existe", quantity: 5, unitCost: 10 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.field).toBe("lines");

    const unchanged = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(unchanged.stock).toBe(10); // no se tocó, a pesar de que esa línea era válida
    const movements = await prisma.inventoryMovement.count({ where: { importBatchId: batch.id } });
    expect(movements).toBe(0);
  });

  it("404 si el lote de importación no existe", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupProductWithVariant();

    const res = await request(app)
      .post("/api/import-batches/id-inexistente/receive")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [{ variantId: variant.id, quantity: 5, unitCost: 10 }] });

    expect(res.status).toBe(404);
  });

  describe("Idempotency-Key", () => {
    it("misma key + mismo body -> devuelve la respuesta guardada sin duplicar el movimiento", async () => {
      const { token } = await createTestUser("ADMIN");
      const { variant } = await setupProductWithVariant(10);
      const batch = await createImportBatchFixture();
      const body = { lines: [{ variantId: variant.id, quantity: 20, unitCost: 22.5 }] };

      const first = await request(app)
        .post(`/api/import-batches/${batch.id}/receive`)
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", "retry-key-1")
        .send(body);
      const second = await request(app)
        .post(`/api/import-batches/${batch.id}/receive`)
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", "retry-key-1")
        .send(body);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);

      const updated = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(updated.stock).toBe(30); // 10 + 20, UNA sola vez, no 10 + 20 + 20
      const movements = await prisma.inventoryMovement.count({ where: { importBatchId: batch.id } });
      expect(movements).toBe(1);
    });

    it("misma key + body distinto -> 422", async () => {
      const { token } = await createTestUser("ADMIN");
      const { variant } = await setupProductWithVariant();
      const batch = await createImportBatchFixture();

      await request(app)
        .post(`/api/import-batches/${batch.id}/receive`)
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", "retry-key-2")
        .send({ lines: [{ variantId: variant.id, quantity: 10, unitCost: 5 }] });

      const res = await request(app)
        .post(`/api/import-batches/${batch.id}/receive`)
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", "retry-key-2")
        .send({ lines: [{ variantId: variant.id, quantity: 999, unitCost: 5 }] });

      expect(res.status).toBe(422);
      expect(res.body.field).toBe("Idempotency-Key");
    });

    it("misma key + otro lote -> 409", async () => {
      const { token } = await createTestUser("ADMIN");
      const { variant } = await setupProductWithVariant();
      const batchA = await createImportBatchFixture();
      const batchB = await createImportBatchFixture();
      const body = { lines: [{ variantId: variant.id, quantity: 10, unitCost: 5 }] };

      await request(app)
        .post(`/api/import-batches/${batchA.id}/receive`)
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", "retry-key-3")
        .send(body);

      const res = await request(app)
        .post(`/api/import-batches/${batchB.id}/receive`)
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", "retry-key-3")
        .send(body);

      expect(res.status).toBe(409);
    });

    it("el orden de las líneas no cambia si dos requests son \"la misma\" para la idempotencia", async () => {
      const { token } = await createTestUser("ADMIN");
      const { variant: v1 } = await setupProductWithVariant();
      const { variant: v2 } = await setupProductWithVariant();
      const batch = await createImportBatchFixture();

      const first = await request(app)
        .post(`/api/import-batches/${batch.id}/receive`)
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", "retry-key-order")
        .send({
          lines: [
            { variantId: v1.id, quantity: 10, unitCost: 5 },
            { variantId: v2.id, quantity: 20, unitCost: 8 },
          ],
        });

      // Mismas líneas, orden invertido: mismo hash -> misma respuesta cacheada.
      const second = await request(app)
        .post(`/api/import-batches/${batch.id}/receive`)
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", "retry-key-order")
        .send({
          lines: [
            { variantId: v2.id, quantity: 20, unitCost: 8 },
            { variantId: v1.id, quantity: 10, unitCost: 5 },
          ],
        });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const movements = await prisma.inventoryMovement.count({ where: { importBatchId: batch.id } });
      expect(movements).toBe(2); // no 4
    });
  });
});

describe("Prorrateo de landedCostPerUnit en /receive", () => {
  it("reparte freightCost+customsCost+otherCosts en partes iguales entre las unidades de ESTE receive", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant: variantA } = await setupProductWithVariant();
    const { variant: variantB } = await setupProductWithVariant();
    const batch = await prisma.importBatch.create({
      data: {
        reference: `CONT-LANDED-${Date.now()}`,
        arrivalDate: new Date(),
        freightCost: 100,
        customsCost: 50,
        otherCosts: 10,
      },
    });

    // total del lote = 160, total unidades de ESTE receive = 12 + 8 = 20 -> landedCostPerUnit = 8
    const res = await request(app)
      .post(`/api/import-batches/${batch.id}/receive`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        lines: [
          { variantId: variantA.id, quantity: 12, unitCost: 10 },
          { variantId: variantB.id, quantity: 8, unitCost: 15 },
        ],
      });

    expect(res.status).toBe(201);
    const movements = await prisma.inventoryMovement.findMany({ where: { importBatchId: batch.id } });
    expect(movements).toHaveLength(2);
    for (const m of movements) {
      expect(Number(m.landedCostPerUnit)).toBe(8);
    }
  });

  it("landedCostPerUnit = 0 (no null) si el lote no tiene ningún costo cargado", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupProductWithVariant();
    const batch = await createImportBatchFixture(); // sin freight/customs/other

    await request(app)
      .post(`/api/import-batches/${batch.id}/receive`)
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [{ variantId: variant.id, quantity: 10, unitCost: 5 }] });

    const movement = await prisma.inventoryMovement.findFirstOrThrow({
      where: { importBatchId: batch.id },
    });
    expect(Number(movement.landedCostPerUnit)).toBe(0);
  });

  it("oculta landedCostPerUnit para OPERATOR igual que unitCost", async () => {
    const { token: adminToken } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const { variant } = await setupProductWithVariant();
    const batch = await prisma.importBatch.create({
      data: { reference: `CONT-HIDE-${Date.now()}`, arrivalDate: new Date(), freightCost: 100 },
    });

    await request(app)
      .post(`/api/import-batches/${batch.id}/receive`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ lines: [{ variantId: variant.id, quantity: 10, unitCost: 5 }] });

    const asAdmin = await request(app)
      .get(`/api/import-batches/${batch.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const asOperator = await request(app)
      .get(`/api/import-batches/${batch.id}`)
      .set("Authorization", `Bearer ${operatorToken}`);

    expect(asAdmin.body.movements[0].landedCostPerUnit).toBe("10");
    expect(
      Object.prototype.hasOwnProperty.call(asOperator.body.movements[0], "landedCostPerUnit")
    ).toBe(false);
  });
});

describe("GET /api/import-batches/:id", () => {
  it("incluye los movimientos INGRESO vinculados, con unitCost oculto para OPERATOR", async () => {
    const { token: adminToken } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const { variant } = await setupProductWithVariant();
    const batch = await createImportBatchFixture();

    await request(app)
      .post(`/api/import-batches/${batch.id}/receive`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ lines: [{ variantId: variant.id, quantity: 10, unitCost: 12.34 }] });

    const asAdmin = await request(app)
      .get(`/api/import-batches/${batch.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    const asOperator = await request(app)
      .get(`/api/import-batches/${batch.id}`)
      .set("Authorization", `Bearer ${operatorToken}`);

    expect(asAdmin.body.movements).toHaveLength(1);
    expect(asAdmin.body.movements[0].unitCost).toBe("12.34");
    expect(Object.prototype.hasOwnProperty.call(asOperator.body.movements[0], "unitCost")).toBe(false);
  });
});
