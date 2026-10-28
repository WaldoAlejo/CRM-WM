import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createCategoryFixture, createProductFixture, createTestUser, prisma, resetDatabase } from "./helpers";

const app = createApp();

afterEach(async () => {
  await resetDatabase();
});

describe("POST /api/products/:id/variants", () => {
  it("autogenera sku y label a partir de attributes", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });

    const res = await request(app)
      .post(`/api/products/${product.id}/variants`)
      .set("Authorization", `Bearer ${token}`)
      .send({ attributes: { color: "Negro", capacidad: "5L" } });

    expect(res.status).toBe(201);
    expect(res.body.sku).toBe(`${product.sku}-NEGRO-5L`);
    expect(res.body.label).toBe("Negro / 5L");
  });

  it("agrega un sufijo numérico si el sku autogenerado ya existe", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });

    await request(app)
      .post(`/api/products/${product.id}/variants`)
      .set("Authorization", `Bearer ${token}`)
      .send({ attributes: { color: "Negro" } });

    const res = await request(app)
      .post(`/api/products/${product.id}/variants`)
      .set("Authorization", `Bearer ${token}`)
      .send({ attributes: { color: "Negro" } }); // mismos atributos -> mismo candidato base

    expect(res.status).toBe(201);
    expect(res.body.sku).toBe(`${product.sku}-NEGRO-2`);
  });

  it("rechaza un sku manual: siempre se genera automáticamente", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });

    const res = await request(app)
      .post(`/api/products/${product.id}/variants`)
      .set("Authorization", `Bearer ${token}`)
      .send({ attributes: { color: "Rojo" }, sku: "SKU-FIJO-TEST" });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("se genera automáticamente");
  });

  it("rechaza attributes vacío", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });

    const res = await request(app)
      .post(`/api/products/${product.id}/variants`)
      .set("Authorization", `Bearer ${token}`)
      .send({ attributes: {} });

    expect(res.status).toBe(400);
  });

  it("rechaza attributes como arreglo", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });

    const res = await request(app)
      .post(`/api/products/${product.id}/variants`)
      .set("Authorization", `Bearer ${token}`)
      .send({ attributes: ["Negro", "5L"] });

    expect(res.status).toBe(400);
  });

  it("bloquea crear variante si el producto está DISCONTINUED sin force", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id, status: "DISCONTINUED" });

    const res = await request(app)
      .post(`/api/products/${product.id}/variants`)
      .set("Authorization", `Bearer ${token}`)
      .send({ attributes: { color: "Negro" } });

    expect(res.status).toBe(400);
  });

  it("permite crear variante en producto DISCONTINUED con force: true", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id, status: "DISCONTINUED" });

    const res = await request(app)
      .post(`/api/products/${product.id}/variants`)
      .set("Authorization", `Bearer ${token}`)
      .send({ attributes: { color: "Negro" }, force: true });

    expect(res.status).toBe(201);
  });
});

describe("DELETE /api/variants/:id", () => {
  it("bloquea el borrado si stock > 0", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `${product.sku}-A`,
        attributes: { color: "Negro" },
        label: "Negro",
        stock: 3,
      },
    });

    const res = await request(app)
      .delete(`/api/variants/${variant.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(409);
  });

  it("permite el borrado si stock = 0", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `${product.sku}-A`,
        attributes: { color: "Negro" },
        label: "Negro",
        stock: 0,
      },
    });

    const res = await request(app)
      .delete(`/api/variants/${variant.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(204);
  });
});

describe("Código de Kestore de la variante", () => {
  it("guarda kestoreCode y rechaza con 409 uno repetido", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });

    const first = await request(app)
      .post(`/api/products/${product.id}/variants`)
      .set("Authorization", `Bearer ${token}`)
      .send({ attributes: { tamaño: "100 mL" }, kestoreCode: "PERKE111" });
    expect(first.status).toBe(201);
    expect(first.body.kestoreCode).toBe("PERKE111");

    const duplicate = await request(app)
      .post(`/api/products/${product.id}/variants`)
      .set("Authorization", `Bearer ${token}`)
      .send({ attributes: { tamaño: "200 mL" }, kestoreCode: "PERKE111" });
    expect(duplicate.status).toBe(409);
    expect(JSON.stringify(duplicate.body)).toContain("código de Kestore");
  });

  it("permite quitar el kestoreCode con null", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, sku: `${product.sku}-X`, attributes: { x: "1" }, kestoreCode: "FOUR003" },
    });

    const res = await request(app)
      .patch(`/api/variants/${variant.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ kestoreCode: null });

    expect(res.status).toBe(200);
    expect(res.body.kestoreCode).toBeNull();
  });
});
