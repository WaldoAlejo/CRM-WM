import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createCategoryFixture, createProductFixture, createTestUser, prisma, resetDatabase } from "./helpers";

const app = createApp();

afterEach(async () => {
  await resetDatabase();
});

describe("POST /api/brands", () => {
  it("ADMIN puede crear una marca", async () => {
    const { token } = await createTestUser("ADMIN");
    const res = await request(app)
      .post("/api/brands")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "WM Home" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("WM Home");
  });

  it("OPERATOR recibe 403", async () => {
    const { token } = await createTestUser("OPERATOR");
    const res = await request(app)
      .post("/api/brands")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Otra Marca" });

    expect(res.status).toBe(403);
  });

  it("409 si ya existe una marca ACTIVA con ese nombre", async () => {
    const { token } = await createTestUser("ADMIN");
    await request(app).post("/api/brands").set("Authorization", `Bearer ${token}`).send({ name: "Duplicada" });

    const res = await request(app)
      .post("/api/brands")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Duplicada" });

    expect(res.status).toBe(409);
  });

  it("índice único parcial: soft-delete una marca y crear una nueva con el MISMO nombre -> 201", async () => {
    const { token } = await createTestUser("ADMIN");
    const created = await request(app)
      .post("/api/brands")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Marca Reciclable" });

    await request(app).delete(`/api/brands/${created.body.id}`).set("Authorization", `Bearer ${token}`);

    const recreated = await request(app)
      .post("/api/brands")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Marca Reciclable" });

    expect(recreated.status).toBe(201);

    const count = await prisma.brand.count({ where: { name: "Marca Reciclable" } });
    expect(count).toBe(2);
  });
});

describe("DELETE /api/brands/:id", () => {
  it("bloquea con 409 si hay productos ACTIVOS asociados", async () => {
    const { token } = await createTestUser("ADMIN");
    const brand = await request(app)
      .post("/api/brands")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Con Productos" });
    const { category } = await createCategoryFixture();
    await createProductFixture({ categoryId: category.id });
    await prisma.product.updateMany({ where: {}, data: { brandId: brand.body.id } });

    const res = await request(app)
      .delete(`/api/brands/${brand.body.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/productos activos asociados/);

    const stillThere = await prisma.brand.findUniqueOrThrow({ where: { id: brand.body.id } });
    expect(stillThere.deletedAt).toBeNull();
  });

  it("permite eliminar una marca sin productos asociados", async () => {
    const { token } = await createTestUser("ADMIN");
    const brand = await request(app)
      .post("/api/brands")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Sin Productos" });

    const res = await request(app)
      .delete(`/api/brands/${brand.body.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(204);
  });
});

describe("GET /api/brands", () => {
  it("lista paginada, accesible para OPERATOR", async () => {
    const { token: adminToken } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    await request(app).post("/api/brands").set("Authorization", `Bearer ${adminToken}`).send({ name: "Listable" });

    const res = await request(app).get("/api/brands").set("Authorization", `Bearer ${operatorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((b: { name: string }) => b.name)).toContain("Listable");
  });
});
