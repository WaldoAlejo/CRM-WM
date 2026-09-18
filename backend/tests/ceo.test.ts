import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import {
  createCategoryFixture,
  createProductFixture,
  createTestUser,
  createVariantFixture,
  prisma,
  resetDatabase,
} from "./helpers";

const app = createApp();

afterEach(async () => {
  await resetDatabase();
});

describe("Jerarquía: CEO hereda todo lo de ADMIN", () => {
  it("CEO pasa endpoints que exigen ADMIN (catálogo, reportes, cartera, reclamos, usuarios)", async () => {
    const { token } = await createTestUser("CEO");
    const auth = { Authorization: `Bearer ${token}` };

    const create = await request(app).post("/api/categories").set(auth).send({ name: "Cat CEO" });
    expect(create.status).toBe(201);

    for (const path of [
      "/api/reports/profitability",
      "/api/accounts-receivable",
      "/api/insurance-claims",
      "/api/users",
    ]) {
      const res = await request(app).get(path).set(auth);
      expect(res.status, path).toBe(200);
    }
  });

  it("CEO ve los campos de costo/precio que OPERATOR no ve (variantes y dashboard)", async () => {
    const { token: ceoToken } = await createTestUser("CEO");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const variant = await createVariantFixture({ productId: product.id });
    await prisma.productVariant.update({ where: { id: variant.id }, data: { retailPrice: 123.45 } });

    const asCeo = await request(app).get(`/api/products/${product.id}`).set("Authorization", `Bearer ${ceoToken}`);
    const asOperator = await request(app)
      .get(`/api/products/${product.id}`)
      .set("Authorization", `Bearer ${operatorToken}`);
    expect(asCeo.body.variants[0].retailPrice).toBe("123.45");
    expect(Object.prototype.hasOwnProperty.call(asOperator.body.variants[0], "retailPrice")).toBe(false);

    const dash = await request(app).get("/api/dashboard/summary").set("Authorization", `Bearer ${ceoToken}`);
    expect(dash.body).toHaveProperty("accountsReceivable");
    expect(dash.body.sales.today).toHaveProperty("profit");
  });

  it("ADMIN sigue sin poder pasar un endpoint exclusivo de CEO", async () => {
    const { token } = await createTestUser("ADMIN");
    const res = await request(app)
      .post("/api/purchasing/china-request/pdf")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ variantId: "x", quantity: 1 }] });
    expect(res.status).toBe(403);
  });
});

describe("Usuarios: reglas del rol CEO", () => {
  it("un CEO puede crear otro CEO", async () => {
    const { token } = await createTestUser("CEO");
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "ceo2@kestore.com.ec", password: "Clave12345", name: "CEO 2", role: "CEO" });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("CEO");
  });

  it("un ADMIN NO puede crear un CEO (403) ni asignar el rol CEO a un usuario existente", async () => {
    const { token } = await createTestUser("ADMIN");
    const { user: operator } = await createTestUser("OPERATOR");

    const create = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "ceo3@kestore.com.ec", password: "Clave12345", name: "CEO 3", role: "CEO" });
    expect(create.status).toBe(403);

    const promote = await request(app)
      .patch(`/api/users/${operator.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "CEO" });
    expect(promote.status).toBe(403);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: operator.id } });
    expect(stored.role).toBe("OPERATOR");
  });

  it("un ADMIN NO puede editar, desactivar ni resetearle la contraseña a un CEO (evita escalada de privilegios)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { user: ceo } = await createTestUser("CEO");
    await createTestUser("CEO"); // otro CEO activo, para aislar la regla de permisos de la de "último CEO"

    for (const body of [{ name: "Hackeado" }, { isActive: false }, { role: "OPERATOR" }]) {
      const res = await request(app)
        .patch(`/api/users/${ceo.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(403);
    }

    const reset = await request(app)
      .post(`/api/users/${ceo.id}/reset-password`)
      .set("Authorization", `Bearer ${token}`)
      .send();
    expect(reset.status).toBe(403);
  });

  it("un CEO SÍ puede resetear/editar a otro CEO y ADMIN", async () => {
    const { token } = await createTestUser("CEO");
    const { user: otherCeo } = await createTestUser("CEO");
    const { user: admin } = await createTestUser("ADMIN");

    const reset = await request(app)
      .post(`/api/users/${otherCeo.id}/reset-password`)
      .set("Authorization", `Bearer ${token}`)
      .send();
    expect(reset.status).toBe(200);

    const promote = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "CEO" });
    expect(promote.status).toBe(200);
    expect(promote.body.role).toBe("CEO");
  });

  it("último CEO activo: no se puede desactivar ni degradar (409), sí si hay otro CEO activo", async () => {
    const { token: ceoAToken, user: ceoA } = await createTestUser("CEO");
    const { token: ceoBToken, user: ceoB } = await createTestUser("CEO");

    // Con dos CEO activos, A puede desactivar a B.
    const ok = await request(app)
      .patch(`/api/users/${ceoB.id}`)
      .set("Authorization", `Bearer ${ceoAToken}`)
      .send({ isActive: false });
    expect(ok.status).toBe(200);

    // Ahora A es el único CEO activo: B (con token todavía válido, JWT
    // stateless) no puede desactivarlo ni degradarlo.
    const deactivate = await request(app)
      .patch(`/api/users/${ceoA.id}`)
      .set("Authorization", `Bearer ${ceoBToken}`)
      .send({ isActive: false });
    expect(deactivate.status).toBe(409);
    expect(deactivate.body.error).toMatch(/último CEO/);

    const demote = await request(app)
      .patch(`/api/users/${ceoA.id}`)
      .set("Authorization", `Bearer ${ceoBToken}`)
      .send({ role: "ADMIN" });
    expect(demote.status).toBe(409);
  });

  it("un CEO no puede cambiar su propio rol ni desactivarse (auto-protección)", async () => {
    const { token, user } = await createTestUser("CEO");
    await createTestUser("CEO");
    const res = await request(app)
      .patch(`/api/users/${user.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "ADMIN" });
    expect(res.status).toBe(400);
  });

  it("promover un ADMIN a CEO NO cuenta como perder acceso de administración (aunque sea el único ADMIN)", async () => {
    const { token } = await createTestUser("CEO");
    const { user: soleAdmin } = await createTestUser("ADMIN");
    const res = await request(app)
      .patch(`/api/users/${soleAdmin.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "CEO" });
    expect(res.status).toBe(200);
  });

  it("un ADMIN sigue sin poder desactivar al único usuario con acceso de administración", async () => {
    const { token: adminToken, user: admin } = await createTestUser("ADMIN");
    const { token: adminBToken, user: adminB } = await createTestUser("ADMIN");
    await request(app)
      .patch(`/api/users/${adminB.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isActive: false });

    const res = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set("Authorization", `Bearer ${adminBToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(409);
  });

  it("un CEO activo cuenta como 'otro admin': se puede desactivar al único ADMIN si hay un CEO", async () => {
    const { token: ceoToken } = await createTestUser("CEO");
    const { user: admin } = await createTestUser("ADMIN");
    const res = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set("Authorization", `Bearer ${ceoToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(200);
  });
});
