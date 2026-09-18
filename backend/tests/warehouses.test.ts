import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createLocationFixture, createTestUser, createWarehouseFixture, prisma, resetDatabase } from "./helpers";

const app = createApp();

afterEach(async () => {
  await resetDatabase();
});

describe("POST /api/warehouses", () => {
  it("ADMIN puede crear una bodega", async () => {
    const { token } = await createTestUser("ADMIN");
    const res = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bodega Central", address: "Av. Principal 123" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Bodega Central");
    expect(res.body.isActive).toBe(true);
  });

  it("OPERATOR recibe 403", async () => {
    const { token } = await createTestUser("OPERATOR");
    const res = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Otra Bodega" });

    expect(res.status).toBe(403);
  });

  it("409 si ya existe una bodega con ese nombre", async () => {
    const { token } = await createTestUser("ADMIN");
    await request(app).post("/api/warehouses").set("Authorization", `Bearer ${token}`).send({ name: "Duplicada" });

    const res = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Duplicada" });

    expect(res.status).toBe(409);
  });
});

describe("GET /api/warehouses", () => {
  it("incluye las ubicaciones activas anidadas", async () => {
    const { token } = await createTestUser("OPERATOR");
    const warehouse = await createWarehouseFixture();
    await createLocationFixture({ warehouseId: warehouse.id, code: "A-1" });

    const res = await request(app).get("/api/warehouses").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const found = res.body.find((w: { id: string }) => w.id === warehouse.id);
    expect(found.locations).toHaveLength(1);
    expect(found.locations[0].code).toBe("A-1");
  });

  it("cualquier usuario autenticado puede consultar (OPERATOR incluido)", async () => {
    const { token } = await createTestUser("OPERATOR");
    const res = await request(app).get("/api/warehouses").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/warehouses/:id", () => {
  it("ADMIN puede editar, OPERATOR recibe 403", async () => {
    const { token: adminToken } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const warehouse = await createWarehouseFixture();

    const forbidden = await request(app)
      .patch(`/api/warehouses/${warehouse.id}`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ address: "Nueva dirección" });
    expect(forbidden.status).toBe(403);

    const ok = await request(app)
      .patch(`/api/warehouses/${warehouse.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ address: "Nueva dirección" });
    expect(ok.status).toBe(200);
    expect(ok.body.address).toBe("Nueva dirección");
  });
});

describe("DELETE /api/warehouses/:id", () => {
  it("pone isActive=false y la saca del listado/GET por id", async () => {
    const { token } = await createTestUser("ADMIN");
    const warehouse = await createWarehouseFixture();

    const res = await request(app)
      .delete(`/api/warehouses/${warehouse.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    const stored = await prisma.warehouse.findUniqueOrThrow({ where: { id: warehouse.id } });
    expect(stored.isActive).toBe(false);

    const getRes = await request(app)
      .get(`/api/warehouses/${warehouse.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(404);
  });

  it("409 si tiene ubicaciones activas — hay que eliminarlas primero", async () => {
    const { token } = await createTestUser("ADMIN");
    const warehouse = await createWarehouseFixture();
    await createLocationFixture({ warehouseId: warehouse.id });

    const res = await request(app)
      .delete(`/api/warehouses/${warehouse.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);

    const stored = await prisma.warehouse.findUniqueOrThrow({ where: { id: warehouse.id } });
    expect(stored.isActive).toBe(true);
  });
});
