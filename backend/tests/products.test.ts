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
      .send({ name: "Producto válido", categoryId: category.id, subcategoryId: subcategory.id });

    expect(res.status).toBe(201);
    expect(res.body.sku).toBe(`${category.code}-0001`);
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
      .send({ name: "Producto con marca inventada", categoryId: category.id, brandId: "id-inexistente" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Marca no encontrada");

    expect(await prisma.product.count()).toBe(0); // nunca se creó
  });

  it("crea el producto con un brandId válido", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const brand = await createBrandFixture();

    const res = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Producto con marca", categoryId: category.id, brandId: brand.id });

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

describe("IVA del producto", () => {
  it("nace con la tarifa general (15%) y ADMIN puede cambiarla con auditoría", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const created = await request(app).post("/api/products").set("Authorization", `Bearer ${token}`).send({ name: "Con IVA", categoryId: category.id });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ ivaCode: "4", ivaRate: "15" });

    const updated = await request(app).patch(`/api/products/${created.body.id}`).set("Authorization", `Bearer ${token}`).send({ ivaCode: "0" });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ ivaCode: "0", ivaRate: "0" });
    expect(await prisma.auditLog.count({ where: { entityType: "ProductTax", entityId: created.body.id } })).toBe(1);
  });

  it("OPERATOR no puede elegir el IVA", async () => {
    const { token } = await createTestUser("OPERATOR");
    const { category } = await createCategoryFixture();
    const res = await request(app).post("/api/products").set("Authorization", `Bearer ${token}`).send({ name: "Sin permiso", categoryId: category.id, ivaCode: "0" });
    expect(res.status).toBe(403);
  });
});
