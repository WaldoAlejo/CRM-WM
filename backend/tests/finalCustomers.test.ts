import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createTestUser, prisma, resetDatabase } from "./helpers";

const app = createApp();

afterEach(async () => {
  await resetDatabase();
});

describe("POST /api/final-customers", () => {
  it("ADMIN y OPERATOR pueden crear (tarea operativa, igual que crear una orden)", async () => {
    const { token: adminToken } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");

    const asAdmin = await request(app)
      .post("/api/final-customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ fullName: "Cliente Admin" });
    expect(asAdmin.status).toBe(201);

    const asOperator = await request(app)
      .post("/api/final-customers")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ fullName: "Cliente Operador" });
    expect(asOperator.status).toBe(201);
  });

  it("409 si ya existe un cliente ACTIVO con el mismo idType+idNumber", async () => {
    const { token } = await createTestUser("ADMIN");
    await request(app)
      .post("/api/final-customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ fullName: "Cliente 1", idType: "CEDULA", idNumber: "1712345678" });

    const res = await request(app)
      .post("/api/final-customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ fullName: "Cliente 2 (otro nombre, misma cédula)", idType: "CEDULA", idNumber: "1712345678" });

    expect(res.status).toBe(409);
    expect(res.body.field).toBe("idNumber");
  });

  it("permite varios clientes sin idNumber (NULL no colisiona consigo mismo)", async () => {
    const { token } = await createTestUser("ADMIN");
    const first = await request(app)
      .post("/api/final-customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ fullName: "Sin Cédula 1" });
    const second = await request(app)
      .post("/api/final-customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ fullName: "Sin Cédula 2" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it("índice único parcial: soft-delete un cliente y crear uno nuevo con el MISMO idType+idNumber -> 201, no 409", async () => {
    const { token } = await createTestUser("ADMIN");
    const created = await request(app)
      .post("/api/final-customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ fullName: "Cliente Reciclable", idType: "CEDULA", idNumber: "0999999999" });
    expect(created.status).toBe(201);

    await request(app)
      .delete(`/api/final-customers/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`);

    const recreated = await request(app)
      .post("/api/final-customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ fullName: "Cliente Nuevo", idType: "CEDULA", idNumber: "0999999999" });

    expect(recreated.status).toBe(201);

    const count = await prisma.finalCustomer.count({
      where: { idType: "CEDULA", idNumber: "0999999999" },
    });
    expect(count).toBe(2);
  });
});

describe("PATCH /api/final-customers/:id", () => {
  it("ADMIN puede editar, OPERATOR recibe 403", async () => {
    const { token: adminToken } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const created = await request(app)
      .post("/api/final-customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ fullName: "Editable" });

    const forbidden = await request(app)
      .patch(`/api/final-customers/${created.body.id}`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ phone: "0988888888" });
    expect(forbidden.status).toBe(403);

    const ok = await request(app)
      .patch(`/api/final-customers/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ phone: "0988888888" });
    expect(ok.status).toBe(200);
    expect(ok.body.phone).toBe("0988888888");
  });
});

describe("GET /api/final-customers", () => {
  it("lista paginada sin soft-deleted, accesible para OPERATOR", async () => {
    const { token } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const created = await request(app)
      .post("/api/final-customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ fullName: "Visible" });
    const toDelete = await request(app)
      .post("/api/final-customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ fullName: "Invisible" });
    await request(app).delete(`/api/final-customers/${toDelete.body.id}`).set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .get("/api/final-customers")
      .set("Authorization", `Bearer ${operatorToken}`);

    expect(res.status).toBe(200);
    const names = res.body.data.map((c: { fullName: string }) => c.fullName);
    expect(names).toContain("Visible");
    expect(names).not.toContain("Invisible");
    expect(created.status).toBe(201);
  });
});
