import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import {
  createCategoryFixture,
  createFinalCustomerFixture,
  createLocationFixture,
  createProductFixture,
  createTestUser,
  createVariantWithIngreso,
  createWarehouseFixture,
  prisma,
  resetDatabase,
} from "./helpers";

const app = createApp();

afterEach(async () => {
  await resetDatabase();
});

describe("POST /api/warehouses/:warehouseId/locations", () => {
  it("ADMIN puede crear una ubicación dentro de una bodega", async () => {
    const { token } = await createTestUser("ADMIN");
    const warehouse = await createWarehouseFixture();

    const res = await request(app)
      .post(`/api/warehouses/${warehouse.id}/locations`)
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "A-1-1", aisle: "A", shelf: "1", level: "1" });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe("A-1-1");
    expect(res.body.warehouseId).toBe(warehouse.id);
  });

  it("OPERATOR recibe 403", async () => {
    const { token } = await createTestUser("OPERATOR");
    const warehouse = await createWarehouseFixture();

    const res = await request(app)
      .post(`/api/warehouses/${warehouse.id}/locations`)
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "A-1-1" });

    expect(res.status).toBe(403);
  });

  it("404 si la bodega no existe", async () => {
    const { token } = await createTestUser("ADMIN");

    const res = await request(app)
      .post("/api/warehouses/id-inexistente/locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "A-1-1" });

    expect(res.status).toBe(404);
  });

  it("409 si el código ya existe EN LA MISMA bodega", async () => {
    const { token } = await createTestUser("ADMIN");
    const warehouse = await createWarehouseFixture();
    await request(app)
      .post(`/api/warehouses/${warehouse.id}/locations`)
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "DUPLICADO" });

    const res = await request(app)
      .post(`/api/warehouses/${warehouse.id}/locations`)
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "DUPLICADO" });

    expect(res.status).toBe(409);
  });

  it("el MISMO código SÍ se permite en OTRA bodega (único es por bodega, no global)", async () => {
    const { token } = await createTestUser("ADMIN");
    const warehouseA = await createWarehouseFixture();
    const warehouseB = await createWarehouseFixture();
    await request(app)
      .post(`/api/warehouses/${warehouseA.id}/locations`)
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "A-1" });

    const res = await request(app)
      .post(`/api/warehouses/${warehouseB.id}/locations`)
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "A-1" });

    expect(res.status).toBe(201);
  });
});

describe("GET /api/warehouses/:warehouseId/locations", () => {
  it("lista solo ubicaciones activas de esa bodega", async () => {
    const { token } = await createTestUser("OPERATOR");
    const warehouse = await createWarehouseFixture();
    const location = await createLocationFixture({ warehouseId: warehouse.id });
    const otherWarehouse = await createWarehouseFixture();
    await createLocationFixture({ warehouseId: otherWarehouse.id });

    const res = await request(app)
      .get(`/api/warehouses/${warehouse.id}/locations`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.map((l: { id: string }) => l.id)).toEqual([location.id]);
  });
});

describe("PATCH /api/locations/:id", () => {
  it("ADMIN puede editar, OPERATOR recibe 403", async () => {
    const { token: adminToken } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const location = await createLocationFixture();

    const forbidden = await request(app)
      .patch(`/api/locations/${location.id}`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ shelf: "2" });
    expect(forbidden.status).toBe(403);

    const ok = await request(app)
      .patch(`/api/locations/${location.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ shelf: "2" });
    expect(ok.status).toBe(200);
    expect(ok.body.shelf).toBe("2");
  });
});

describe("DELETE /api/locations/:id (desactivar)", () => {
  it("pone isActive=false y la saca del listado", async () => {
    const { token } = await createTestUser("ADMIN");
    const warehouse = await createWarehouseFixture();
    const location = await createLocationFixture({ warehouseId: warehouse.id });

    const res = await request(app)
      .delete(`/api/locations/${location.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    const stored = await prisma.location.findUniqueOrThrow({ where: { id: location.id } });
    expect(stored.isActive).toBe(false);

    const list = await request(app)
      .get(`/api/warehouses/${warehouse.id}/locations`)
      .set("Authorization", `Bearer ${token}`);
    expect(list.body).toHaveLength(0);
  });

  it("409 si la ubicación todavía tiene stock neto distinto de 0", async () => {
    const { token } = await createTestUser("ADMIN");
    const location = await createLocationFixture();
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const variant = await createVariantWithIngreso({ productId: product.id, quantity: 10, unitCost: 5 });

    await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${token}`)
      .send({ variantId: variant.id, quantity: 4, reason: "Ingreso a ubicación", locationId: location.id });

    const res = await request(app)
      .delete(`/api/locations/${location.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);

    const stored = await prisma.location.findUniqueOrThrow({ where: { id: location.id } });
    expect(stored.isActive).toBe(true);
  });

  it("se puede eliminar una vez que el stock neto vuelve a 0", async () => {
    const { token } = await createTestUser("ADMIN");
    const location = await createLocationFixture();
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const variant = await createVariantWithIngreso({ productId: product.id, quantity: 10, unitCost: 5 });

    await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${token}`)
      .send({ variantId: variant.id, quantity: 4, reason: "Ingreso a ubicación", locationId: location.id });
    await request(app)
      .post("/api/inventory/adjustments")
      .set("Authorization", `Bearer ${token}`)
      .send({ variantId: variant.id, quantity: -4, reason: "Se retira de la ubicación", locationId: location.id });

    const res = await request(app)
      .delete(`/api/locations/${location.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);
  });

  it("409 si hay ítems de órdenes PENDIENTE que todavía la usan como origen", async () => {
    const { token } = await createTestUser("ADMIN");
    const location = await createLocationFixture();
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const variant = await createVariantWithIngreso({ productId: product.id, quantity: 20, unitCost: 5 });
    const finalCustomer = await createFinalCustomerFixture();

    await request(app)
      .post("/api/dispatch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        buyerType: "CLIENTE_FINAL",
        finalCustomerId: finalCustomer.id,
        shippingProvince: "Pichincha",
        shippingCity: "Quito",
        paymentMethod: "CONTADO",
        items: [{ variantId: variant.id, quantity: 3, priceType: "PVP", unitPrice: 15, locationId: location.id }],
      });

    const res = await request(app)
      .delete(`/api/locations/${location.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
  });
});
