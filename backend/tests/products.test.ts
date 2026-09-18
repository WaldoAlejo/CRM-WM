import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import {
  createBrandFixture,
  createCategoryFixture,
  createProductFixture,
  createTestUser,
  prisma,
  resetDatabase,
} from "./helpers";

const app = createApp();

afterEach(async () => {
  await resetDatabase();
});

describe("POST /api/products", () => {
  it("crea un producto correctamente", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category, subcategory } = await createCategoryFixture();

    const res = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ sku: "WM-9001", name: "Producto válido", categoryId: category.id, subcategoryId: subcategory.id });

    expect(res.status).toBe(201);
    expect(res.body.sku).toBe("WM-9001");
    expect(res.body.subcategoryId).toBe(subcategory.id);
  });

  it("rechaza una subcategoría que no pertenece a la categoría indicada", async () => {
    const { token } = await createTestUser("ADMIN");
    const { subcategory } = await createCategoryFixture(); // subcategoría de la categoría A
    const { category: categoryB } = await createCategoryFixture(); // categoría B, sin relación

    const res = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({
        sku: "WM-9002",
        name: "Producto mal clasificado",
        categoryId: categoryB.id,
        subcategoryId: subcategory.id,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no pertenece a la categoría/);
  });

  it("404 explícito si brandId no existe (en vez de dejar caer un P2003 al 409 genérico)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();

    const res = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ sku: "WM-9003", name: "Producto con marca inventada", categoryId: category.id, brandId: "id-inexistente" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Marca no encontrada");

    const created = await prisma.product.findUnique({ where: { sku: "WM-9003" } });
    expect(created).toBeNull(); // nunca se creó
  });

  it("crea el producto con un brandId válido", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const brand = await createBrandFixture();

    const res = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ sku: "WM-9004", name: "Producto con marca", categoryId: category.id, brandId: brand.id });

    expect(res.status).toBe(201);
    expect(res.body.brandId).toBe(brand.id);
  });
});

describe("PATCH /api/products/:id", () => {
  it("exige confirmar subcategoryId si cambia categoryId y el producto ya tenía una asignada", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category, subcategory } = await createCategoryFixture();
    const { category: otherCategory } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id, subcategoryId: subcategory.id });

    const res = await request(app)
      .patch(`/api/products/${product.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ categoryId: otherCategory.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/confirmar la subcategoría/);
  });

  it("permite cambiar de categoría si se confirma subcategoryId (incluso como null)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category, subcategory } = await createCategoryFixture();
    const { category: otherCategory } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id, subcategoryId: subcategory.id });

    const res = await request(app)
      .patch(`/api/products/${product.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ categoryId: otherCategory.id, subcategoryId: null });

    expect(res.status).toBe(200);
    expect(res.body.categoryId).toBe(otherCategory.id);
    expect(res.body.subcategoryId).toBeNull();
  });

  it("no exige confirmación si el producto no tenía subcategoría asignada", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const { category: otherCategory } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id }); // sin subcategoryId

    const res = await request(app)
      .patch(`/api/products/${product.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ categoryId: otherCategory.id });

    expect(res.status).toBe(200);
  });

  it("rechaza una subcategoría de otra categoría también en PATCH", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const { subcategory: foreignSubcategory } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });

    const res = await request(app)
      .patch(`/api/products/${product.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ subcategoryId: foreignSubcategory.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no pertenece a la categoría/);
  });

  it("404 explícito si brandId no existe también en PATCH", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });

    const res = await request(app)
      .patch(`/api/products/${product.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ brandId: "id-inexistente" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Marca no encontrada");
  });
});

describe("DELETE /api/products/:id", () => {
  it("bloquea el borrado si alguna variante tiene stock", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `${product.sku}-A`,
        attributes: { color: "Negro" },
        label: "Negro",
        stock: 5,
      },
    });

    const res = await request(app)
      .delete(`/api/products/${product.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(409);
  });

  it("permite el borrado si el stock de todas las variantes es 0", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `${product.sku}-A`,
        attributes: { color: "Negro" },
        label: "Negro",
        stock: 0,
      },
    });

    const res = await request(app)
      .delete(`/api/products/${product.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(204);
  });
});
