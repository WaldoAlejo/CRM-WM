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

describe("GET /api/search", () => {
  it("no expone campos de precio/costo en ningún resultado", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    await request(app)
      .post(`/api/products/${product.id}/variants`)
      .set("Authorization", `Bearer ${token}`)
      .send({ attributes: { color: "Negro" }, costPriceUSD: 50, wholesalePrice: 30, retailPrice: 45 });

    const res = await request(app)
      .get(`/api/search?q=${product.sku}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);

    const raw = JSON.stringify(res.body);
    for (const field of PRICING_FIELDS) {
      expect(raw).not.toContain(field);
    }
  });

  it("encuentra una variante por su propio sku", async () => {
    const { token } = await createTestUser("ADMIN");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const created = await request(app)
      .post(`/api/products/${product.id}/variants`)
      .set("Authorization", `Bearer ${token}`)
      .send({ attributes: { color: "Negro" } });

    const res = await request(app)
      .get(`/api/search?q=${created.body.sku}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((v: { sku: string }) => v.sku)).toContain(created.body.sku);
  });
});
