import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createCategoryFixture, createProductFixture, createTestUser, resetDatabase } from "./helpers";

const app = createApp();

const PRICING_FIELDS = [
  "costPriceUSD",
  "wholesalePrice",
  "wholesaleDiscountPct",
  "retailPrice",
  "retailDiscountPct",
];

afterEach(async () => {
  await resetDatabase();
});

describe("Restricción de precios/costos por rol", () => {
  it("OPERATOR recibe 403 al crear una variante con un campo de precio", async () => {
    const { token } = await createTestUser("OPERATOR");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });

    const res = await request(app)
      .post(`/api/products/${product.id}/variants`)
      .set("Authorization", `Bearer ${token}`)
      .send({ attributes: { color: "Negro" }, wholesalePrice: 20 });

    expect(res.status).toBe(403);
  });

  it("OPERATOR recibe 403 al editar una variante con un campo de precio", async () => {
    const { token: adminToken } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const created = await request(app)
      .post(`/api/products/${product.id}/variants`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ attributes: { color: "Negro" } });

    const res = await request(app)
      .patch(`/api/variants/${created.body.id}`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ retailDiscountPct: 10 });

    expect(res.status).toBe(403);
  });

  it("OPERATOR puede crear/editar una variante mientras no toque campos de precio", async () => {
    const { token } = await createTestUser("OPERATOR");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });

    const res = await request(app)
      .post(`/api/products/${product.id}/variants`)
      .set("Authorization", `Bearer ${token}`)
      .send({ attributes: { color: "Negro" }, warehouseLocation: "Pasillo A" });

    expect(res.status).toBe(201);
  });

  it("ADMIN sí puede escribir campos de precio", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });

    const res = await request(app)
      .post(`/api/products/${product.id}/variants`)
      .set("Authorization", `Bearer ${token}`)
      .send({ attributes: { color: "Negro" }, wholesalePrice: 20 });

    expect(res.status).toBe(201);
  });

  it("GET /products/:id oculta los campos de precio para OPERATOR (ausentes, no null)", async () => {
    const { token: adminToken } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    await request(app)
      .post(`/api/products/${product.id}/variants`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ attributes: { color: "Negro" }, costPriceUSD: 50, wholesalePrice: 30, retailPrice: 45 });

    const res = await request(app)
      .get(`/api/products/${product.id}`)
      .set("Authorization", `Bearer ${operatorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.variants).toHaveLength(1);
    const variant = res.body.variants[0];
    for (const field of PRICING_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(variant, field)).toBe(false);
    }
  });

  it("GET /products/:id muestra los campos de precio completos para ADMIN", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    await request(app)
      .post(`/api/products/${product.id}/variants`)
      .set("Authorization", `Bearer ${token}`)
      .send({ attributes: { color: "Negro" }, costPriceUSD: 50, wholesalePrice: 30, retailPrice: 45 });

    const res = await request(app).get(`/api/products/${product.id}`).set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const variant = res.body.variants[0];
    expect(Number(variant.costPriceUSD)).toBe(50);
    expect(Number(variant.wholesalePrice)).toBe(30);
    expect(Number(variant.retailPrice)).toBe(45);
  });
});
