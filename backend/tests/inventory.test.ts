import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import {
  createCategoryFixture,
  createImportBatchFixture,
  createLocationFixture,
  createProductFixture,
  createTestUser,
  createVariantFixture,
  createWarehouseFixture,
  prisma,
  resetDatabase,
} from "./helpers";

const app = createApp();

afterEach(async () => {
  await resetDatabase();
});

async function setupProductWithVariant(initialStock = 0, minStock: number | null = null) {
  const { category } = await createCategoryFixture();
  const product = await createProductFixture({ categoryId: category.id });
  const variant = await createVariantFixture({ productId: product.id, stock: initialStock, minStock });
  return { category, product, variant };
}

describe("POST /api/inventory/adjustments", () => {
  it("ADMIN puede crear un ajuste positivo y uno negativo", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupProductWithVariant(10);

    const negative = await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${token}`)
      .send({ variantId: variant.id, quantity: -3, reason: "Merma por rotura" });
    expect(negative.status).toBe(201);
    expect(negative.body.stockAfter).toBe(7);

    const positive = await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${token}`)
      .send({ variantId: variant.id, quantity: 5, reason: "Corrección de conteo físico" });
    expect(positive.status).toBe(201);
    expect(positive.body.stockAfter).toBe(12);

    const updated = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updated.stock).toBe(12);
  });

  it("OPERATOR recibe 403 (ajustes son admin-only)", async () => {
    const { token } = await createTestUser("OPERATOR");
    const { variant } = await setupProductWithVariant(10);

    const res = await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${token}`)
      .send({ variantId: variant.id, quantity: -1, reason: "Intento de operador" });

    expect(res.status).toBe(403);
  });

  it("rechaza reason vacío", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupProductWithVariant(10);

    const res = await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${token}`)
      .send({ variantId: variant.id, quantity: -1, reason: "" });

    expect(res.status).toBe(400);
  });

  it("rechaza quantity = 0", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupProductWithVariant(10);

    const res = await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${token}`)
      .send({ variantId: variant.id, quantity: 0, reason: "algo" });

    expect(res.status).toBe(400);
  });

  it("rechaza un ajuste que dejaría el stock en negativo", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupProductWithVariant(5);

    const res = await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${token}`)
      .send({ variantId: variant.id, quantity: -20, reason: "Merma grande" });

    expect(res.status).toBe(400);

    const unchanged = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(unchanged.stock).toBe(5); // no se aplicó nada, la transacción revirtió
  });

  it("404 si la variante no existe", async () => {
    const { token } = await createTestUser("ADMIN");

    const res = await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${token}`)
      .send({ variantId: "id-inexistente", quantity: -1, reason: "algo" });

    expect(res.status).toBe(404);
  });

  it("un ajuste positivo con locationId lo guarda en toLocationId, uno negativo en fromLocationId", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupProductWithVariant(10);
    const location = await createLocationFixture();

    const positive = await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${token}`)
      .send({ variantId: variant.id, quantity: 5, reason: "Ingreso manual", locationId: location.id });
    expect(positive.status).toBe(201);
    expect(positive.body.toLocationId).toBe(location.id);
    expect(positive.body.fromLocationId).toBeNull();

    const negative = await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${token}`)
      .send({ variantId: variant.id, quantity: -3, reason: "Merma", locationId: location.id });
    expect(negative.status).toBe(201);
    expect(negative.body.fromLocationId).toBe(location.id);
    expect(negative.body.toLocationId).toBeNull();
  });

  it("404 si la ubicación indicada no existe", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupProductWithVariant(10);

    const res = await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${token}`)
      .send({ variantId: variant.id, quantity: 1, reason: "algo", locationId: "id-inexistente" });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/inventory/movements", () => {
  it("filtra por variantId y type, y oculta unitCost para OPERATOR", async () => {
    const { token: adminToken } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const { variant: variantA } = await setupProductWithVariant(10);
    const { variant: variantB } = await setupProductWithVariant(10);
    const batch = await createImportBatchFixture();

    await request(app)
      .post(`/api/import-batches/${batch.id}/receive`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ lines: [{ variantId: variantA.id, quantity: 5, volumeCbm: 1, unitCost: 9.99, locationId: (await createLocationFixture()).id }] });
    await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ variantId: variantB.id, quantity: -2, reason: "test" });

    const onlyVariantA = await request(app)
      .get(`/api/inventory/movements?variantId=${variantA.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(onlyVariantA.body.data).toHaveLength(1);
    expect(onlyVariantA.body.data[0].unitCost).toBe("9.99");

    const onlyAdjustments = await request(app)
      .get("/api/inventory/movements?type=AJUSTE")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(onlyAdjustments.body.data).toHaveLength(1);
    expect(onlyAdjustments.body.data[0].type).toBe("AJUSTE");

    const asOperator = await request(app)
      .get(`/api/inventory/movements?variantId=${variantA.id}`)
      .set("Authorization", `Bearer ${operatorToken}`);
    expect(Object.prototype.hasOwnProperty.call(asOperator.body.data[0], "unitCost")).toBe(false);
  });
});

describe("GET /api/inventory/stock-summary", () => {
  it("calcula availableStock y marca belowMinStock correctamente", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant: low } = await setupProductWithVariant(2, 5); // stock 2, minStock 5 -> below
    const { variant: ok } = await setupProductWithVariant(10, 5); // stock 10, minStock 5 -> ok
    await prisma.productVariant.update({ where: { id: low.id }, data: { reservedStock: 1 } });

    const res = await request(app)
      .get("/api/inventory/stock-summary")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const lowRow = res.body.data.find((r: { variantId: string }) => r.variantId === low.id);
    const okRow = res.body.data.find((r: { variantId: string }) => r.variantId === ok.id);
    expect(lowRow.availableStock).toBe(1); // 2 - 1
    expect(lowRow.belowMinStock).toBe(true);
    expect(okRow.belowMinStock).toBe(false);
  });

  it("filtra por belowMinStock=true paginando correctamente sobre el conjunto ya filtrado", async () => {
    const { token } = await createTestUser("ADMIN");
    // 3 variantes bajo mínimo, 2 que no.
    await setupProductWithVariant(1, 10);
    await setupProductWithVariant(2, 10);
    await setupProductWithVariant(3, 10);
    await setupProductWithVariant(20, 10);
    await setupProductWithVariant(30, 10);

    const res = await request(app)
      .get("/api/inventory/stock-summary?belowMinStock=true&pageSize=2&page=1")
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.pagination.total).toBe(3); // no 5
    expect(res.body.data).toHaveLength(2); // pageSize respetado sobre el total filtrado
    expect(res.body.data.every((r: { belowMinStock: boolean }) => r.belowMinStock)).toBe(true);
  });
});

describe("GET /api/inventory/stock-by-location", () => {
  it("agrega el ledger por ubicación sin doble contar ingresos y salidas", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupProductWithVariant(0);
    const warehouse = await createWarehouseFixture();
    const locationA = await createLocationFixture({ warehouseId: warehouse.id, code: "A" });
    const locationB = await createLocationFixture({ warehouseId: warehouse.id, code: "B" });

    // 10 ingresan a A, 4 salen de A (ajuste), 3 ingresan a B.
    await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${token}`)
      .send({ variantId: variant.id, quantity: 10, reason: "Ingreso inicial", locationId: locationA.id });
    await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${token}`)
      .send({ variantId: variant.id, quantity: -4, reason: "Merma", locationId: locationA.id });
    await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${token}`)
      .send({ variantId: variant.id, quantity: 3, reason: "Ingreso inicial", locationId: locationB.id });

    const res = await request(app)
      .get(`/api/inventory/stock-by-location?variantId=${variant.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const rowA = res.body.data.find((r: { locationId: string }) => r.locationId === locationA.id);
    const rowB = res.body.data.find((r: { locationId: string }) => r.locationId === locationB.id);
    expect(rowA.netStock).toBe(6); // 10 - 4
    expect(rowB.netStock).toBe(3);
    expect(rowA.warehouseId).toBe(warehouse.id);
  });

  it("filtra por warehouseId", async () => {
    const { token } = await createTestUser("ADMIN");
    const { variant } = await setupProductWithVariant(0);
    const warehouseA = await createWarehouseFixture();
    const warehouseB = await createWarehouseFixture();
    const locationA = await createLocationFixture({ warehouseId: warehouseA.id });
    const locationB = await createLocationFixture({ warehouseId: warehouseB.id });

    await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${token}`)
      .send({ variantId: variant.id, quantity: 5, reason: "x", locationId: locationA.id });
    await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${token}`)
      .send({ variantId: variant.id, quantity: 7, reason: "x", locationId: locationB.id });

    const res = await request(app)
      .get(`/api/inventory/stock-by-location?warehouseId=${warehouseA.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].locationId).toBe(locationA.id);
    expect(res.body.data[0].netStock).toBe(5);
  });
});
