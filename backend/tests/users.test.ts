import bcrypt from "bcryptjs";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createTestUser, prisma, resetDatabase } from "./helpers";

const app = createApp();

afterEach(async () => {
  await resetDatabase();
});

describe("POST /api/users", () => {
  it("ADMIN puede crear un usuario", async () => {
    const { token } = await createTestUser("ADMIN");

    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "nuevo@kestore.com.ec", password: "Clave1234", name: "Nuevo Usuario", role: "OPERATOR" });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe("nuevo@kestore.com.ec");
    expect(res.body.role).toBe("OPERATOR");
    expect(res.body.isActive).toBe(true);
    // passwordHash nunca debe salir en la respuesta.
    expect(Object.prototype.hasOwnProperty.call(res.body, "passwordHash")).toBe(false);
  });

  it("OPERATOR recibe 403 (ni siquiera puede consultar este módulo)", async () => {
    const { token } = await createTestUser("OPERATOR");

    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "x@kestore.com.ec", password: "Clave1234", name: "X", role: "OPERATOR" });

    expect(res.status).toBe(403);
  });

  it("409 si el email ya existe", async () => {
    const { token } = await createTestUser("ADMIN");
    await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "dup@kestore.com.ec", password: "Clave1234", name: "A", role: "OPERATOR" });

    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "dup@kestore.com.ec", password: "Clave1234", name: "B", role: "OPERATOR" });

    expect(res.status).toBe(409);
  });

  it("rechaza contraseña de menos de 8 caracteres", async () => {
    const { token } = await createTestUser("ADMIN");

    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "corta@kestore.com.ec", password: "abc123", name: "Corta", role: "OPERATOR" });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/users", () => {
  it("lista usuarios activos e inactivos (no solo activos)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { user: inactiveUser } = await createTestUser("OPERATOR");
    await prisma.user.update({ where: { id: inactiveUser.id }, data: { isActive: false } });

    const res = await request(app).get("/api/users").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.map((u: { id: string }) => u.id);
    expect(ids).toContain(inactiveUser.id);
    const row = res.body.find((u: { id: string }) => u.id === inactiveUser.id);
    expect(row.isActive).toBe(false);
  });

  it("OPERATOR recibe 403", async () => {
    const { token } = await createTestUser("OPERATOR");
    const res = await request(app).get("/api/users").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/users/:id", () => {
  it("404 si no existe", async () => {
    const { token } = await createTestUser("ADMIN");
    const res = await request(app).get("/api/users/id-inexistente").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/users/:id — edición general", () => {
  it("ADMIN puede editar nombre, email y rol de OTRO usuario", async () => {
    const { token } = await createTestUser("ADMIN");
    const { user: target } = await createTestUser("OPERATOR");

    const res = await request(app)
      .patch(`/api/users/${target.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Editado", role: "ADMIN" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Editado");
    expect(res.body.role).toBe("ADMIN");
  });

  it("OPERATOR recibe 403", async () => {
    const { token } = await createTestUser("OPERATOR");
    const { user: target } = await createTestUser("OPERATOR");

    const res = await request(app)
      .patch(`/api/users/${target.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Intento" });

    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/users/:id — auto-protección", () => {
  it("un admin NO puede cambiar su propio rol", async () => {
    const { token, user } = await createTestUser("ADMIN");
    // Segundo admin para que no choque con la regla de "último admin" y
    // aislar específicamente la regla de auto-protección.
    await createTestUser("ADMIN");

    const res = await request(app)
      .patch(`/api/users/${user.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "OPERATOR" });

    expect(res.status).toBe(400);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.role).toBe("ADMIN");
  });

  it("un admin NO puede desactivarse a sí mismo", async () => {
    const { token, user } = await createTestUser("ADMIN");
    await createTestUser("ADMIN");

    const res = await request(app)
      .patch(`/api/users/${user.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ isActive: false });

    expect(res.status).toBe(400);
  });

  it("SÍ puede editar su propio nombre/email", async () => {
    const { token, user } = await createTestUser("ADMIN");

    const res = await request(app)
      .patch(`/api/users/${user.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Mi Nombre Nuevo" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Mi Nombre Nuevo");
  });
});

describe("PATCH /api/users/:id — protección del último admin activo", () => {
  it("409 al intentar desactivar al único admin activo", async () => {
    const { token: adminToken, user: admin } = await createTestUser("ADMIN");
    const { token: otherAdminToken, user: otherAdmin } = await createTestUser("ADMIN");
    // Desactiva a uno de los dos primero (por otro admin distinto), dejando
    // solo `admin` activo — y ahí sí debe bloquearse.
    await request(app)
      .patch(`/api/users/${otherAdmin.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isActive: false });

    const res = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set("Authorization", `Bearer ${otherAdminToken}`) // token de otherAdmin, ya desactivado, pero token sigue siendo válido (JWT stateless)
      .send({ isActive: false });

    expect(res.status).toBe(409);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(stored.isActive).toBe(true);
  });

  it("409 al intentar degradar a OPERATOR al único admin activo", async () => {
    const { user: admin } = await createTestUser("ADMIN");
    const { token: secondAdminToken, user: secondAdmin } = await createTestUser("ADMIN");
    await prisma.user.update({ where: { id: secondAdmin.id }, data: { isActive: false } });

    const res = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set("Authorization", `Bearer ${secondAdminToken}`)
      .send({ role: "OPERATOR" });

    expect(res.status).toBe(409);
  });

  it("permite desactivar/degradar a un admin si hay OTRO admin activo", async () => {
    const { token: adminAToken } = await createTestUser("ADMIN");
    const { user: adminB } = await createTestUser("ADMIN");

    const res = await request(app)
      .patch(`/api/users/${adminB.id}`)
      .set("Authorization", `Bearer ${adminAToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });

  it("un admin inactivo no cuenta como protección — se puede tocar al único admin ACTIVO", async () => {
    const { user: inactiveAdmin } = await createTestUser("ADMIN");
    await prisma.user.update({ where: { id: inactiveAdmin.id }, data: { isActive: false } });
    const { token: activeAdminToken, user: activeAdmin } = await createTestUser("ADMIN");
    const { token: thirdAdminToken, user: thirdAdmin } = await createTestUser("ADMIN");

    // Desactiva a thirdAdmin desde activeAdmin, dejando a activeAdmin como el
    // único admin ACTIVO (inactiveAdmin no cuenta).
    await request(app)
      .patch(`/api/users/${thirdAdmin.id}`)
      .set("Authorization", `Bearer ${activeAdminToken}`)
      .send({ isActive: false });

    const res = await request(app)
      .patch(`/api/users/${activeAdmin.id}`)
      .set("Authorization", `Bearer ${thirdAdminToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(409);
  });
});

describe("POST /api/users/:id/reset-password", () => {
  it("genera una contraseña temporal, la devuelve una sola vez, y sirve para loguear", async () => {
    const { token } = await createTestUser("ADMIN");
    const { user: target } = await createTestUser("OPERATOR");
    // Le pone una contraseña conocida primero (createTestUser usa "Test123!").

    const res = await request(app)
      .post(`/api/users/${target.id}/reset-password`)
      .set("Authorization", `Bearer ${token}`)
      .send();

    expect(res.status).toBe(200);
    expect(typeof res.body.temporaryPassword).toBe("string");
    expect(res.body.temporaryPassword.length).toBeGreaterThanOrEqual(8);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    const matchesNew = await bcrypt.compare(res.body.temporaryPassword, stored.passwordHash);
    expect(matchesNew).toBe(true);
    const matchesOld = await bcrypt.compare("Test123!", stored.passwordHash);
    expect(matchesOld).toBe(false);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: target.email, password: res.body.temporaryPassword });
    expect(loginRes.status).toBe(200);
  });

  it("OPERATOR recibe 403", async () => {
    const { token } = await createTestUser("OPERATOR");
    const { user: target } = await createTestUser("OPERATOR");

    const res = await request(app)
      .post(`/api/users/${target.id}/reset-password`)
      .set("Authorization", `Bearer ${token}`)
      .send();

    expect(res.status).toBe(403);
  });

  it("404 si el usuario no existe", async () => {
    const { token } = await createTestUser("ADMIN");
    const res = await request(app)
      .post("/api/users/id-inexistente/reset-password")
      .set("Authorization", `Bearer ${token}`)
      .send();
    expect(res.status).toBe(404);
  });
});
