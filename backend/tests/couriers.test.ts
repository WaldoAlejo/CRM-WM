import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createTestUser, prisma, resetDatabase } from "./helpers";

const app = createApp();

afterEach(async () => {
  await resetDatabase();
});

describe("POST /api/couriers", () => {
  it("ADMIN puede crear un courier", async () => {
    const { token } = await createTestUser("ADMIN");
    const res = await request(app)
      .post("/api/couriers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Servientrega" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Servientrega");
  });

  it("OPERATOR recibe 403", async () => {
    const { token } = await createTestUser("OPERATOR");
    const res = await request(app)
      .post("/api/couriers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Otro Courier" });

    expect(res.status).toBe(403);
  });

  it("409 si ya existe un courier con ese nombre", async () => {
    const { token } = await createTestUser("ADMIN");
    await request(app).post("/api/couriers").set("Authorization", `Bearer ${token}`).send({ name: "Duplicado" });

    const res = await request(app)
      .post("/api/couriers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Duplicado" });

    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/couriers/:id (desactivar)", () => {
  it("pone isActive=false y lo saca del listado/GET por id", async () => {
    const { token } = await createTestUser("ADMIN");
    const created = await request(app)
      .post("/api/couriers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "A Desactivar" });

    const res = await request(app)
      .delete(`/api/couriers/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    const stored = await prisma.courier.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.isActive).toBe(false);

    const getRes = await request(app)
      .get(`/api/couriers/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(404);

    const list = await request(app).get("/api/couriers").set("Authorization", `Bearer ${token}`);
    expect(list.body.data.map((c: { id: string }) => c.id)).not.toContain(created.body.id);
  });

  it("a diferencia de Supplier/Brand: `name` sigue siendo único SIN importar isActive (no es un índice parcial) -> 409 al recrear", async () => {
    const { token } = await createTestUser("ADMIN");
    const created = await request(app)
      .post("/api/couriers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Nombre Unico" });
    await request(app).delete(`/api/couriers/${created.body.id}`).set("Authorization", `Bearer ${token}`);

    const recreated = await request(app)
      .post("/api/couriers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Nombre Unico" });

    expect(recreated.status).toBe(409);
  });
});

describe("PATCH /api/couriers/:id", () => {
  it("ADMIN puede editar, OPERATOR recibe 403", async () => {
    const { token: adminToken } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const created = await request(app)
      .post("/api/couriers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Editable" });

    const forbidden = await request(app)
      .patch(`/api/couriers/${created.body.id}`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ contactInfo: "0999999999" });
    expect(forbidden.status).toBe(403);

    const ok = await request(app)
      .patch(`/api/couriers/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ contactInfo: "0999999999" });
    expect(ok.status).toBe(200);
    expect(ok.body.contactInfo).toBe("0999999999");
  });
});
