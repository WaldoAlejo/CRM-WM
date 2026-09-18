import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createTestUser, prisma, resetDatabase } from "./helpers";

const app = createApp();

afterEach(async () => {
  await resetDatabase();
});

describe("POST /api/suppliers", () => {
  it("ADMIN puede crear un proveedor", async () => {
    const { token } = await createTestUser("ADMIN");

    const res = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Proveedor Shenzhen", contactInfo: "WeChat: abc123" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Proveedor Shenzhen");
  });

  it("OPERATOR recibe 403", async () => {
    const { token } = await createTestUser("OPERATOR");

    const res = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Proveedor X" });

    expect(res.status).toBe(403);
  });

  it("409 si ya existe un proveedor ACTIVO con ese nombre", async () => {
    const { token } = await createTestUser("ADMIN");
    await request(app).post("/api/suppliers").set("Authorization", `Bearer ${token}`).send({ name: "Duplicado" });

    const res = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Duplicado" });

    expect(res.status).toBe(409);
    expect(res.body.field).toBe("name");
  });

  it("índice único parcial: soft-delete un proveedor y crear uno nuevo con el MISMO nombre -> 201, no 409", async () => {
    const { token } = await createTestUser("ADMIN");
    const created = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Proveedor Reciclable" });
    expect(created.status).toBe(201);

    const deleted = await request(app)
      .delete(`/api/suppliers/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(deleted.status).toBe(204);

    const recreated = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Proveedor Reciclable" });

    expect(recreated.status).toBe(201);
    expect(recreated.body.id).not.toBe(created.body.id);

    // Y ahora SÍ hay dos filas físicas con el mismo `name` en la tabla (una
    // soft-deleted, una activa) — la unicidad real es solo entre las activas.
    const count = await prisma.supplier.count({ where: { name: "Proveedor Reciclable" } });
    expect(count).toBe(2);
  });
});

describe("GET /api/suppliers", () => {
  it("lista paginada, accesible para ADMIN y OPERATOR, sin soft-deleted", async () => {
    const { token: adminToken } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const created = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Visible" });
    const toDelete = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Invisible" });
    await request(app)
      .delete(`/api/suppliers/${toDelete.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    const res = await request(app).get("/api/suppliers").set("Authorization", `Bearer ${operatorToken}`);

    expect(res.status).toBe(200);
    const names = res.body.data.map((s: { name: string }) => s.name);
    expect(names).toContain("Visible");
    expect(names).not.toContain("Invisible");
    expect(res.body.pagination).toMatchObject({ page: 1, pageSize: 20 });
    expect(created.status).toBe(201);
  });
});

describe("GET /api/suppliers/:id", () => {
  it("404 si no existe o está soft-deleted", async () => {
    const { token } = await createTestUser("ADMIN");
    const created = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Temporal" });
    await request(app).delete(`/api/suppliers/${created.body.id}`).set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .get(`/api/suppliers/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/suppliers/:id", () => {
  it("ADMIN puede editar, OPERATOR recibe 403", async () => {
    const { token: adminToken } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const created = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Editable" });

    const forbidden = await request(app)
      .patch(`/api/suppliers/${created.body.id}`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ contactInfo: "nuevo contacto" });
    expect(forbidden.status).toBe(403);

    const ok = await request(app)
      .patch(`/api/suppliers/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ contactInfo: "nuevo contacto" });
    expect(ok.status).toBe(200);
    expect(ok.body.contactInfo).toBe("nuevo contacto");
  });
});
