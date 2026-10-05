import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { suggestCategoryCode } from "../src/lib/sku";
import { createCategoryFixture, createTestUser, createVariantWithIngreso, prisma, resetDatabase } from "./helpers";

const app = createApp();
afterEach(async () => { await resetDatabase(); });
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("Códigos uniformes", () => {
  it("sugiere códigos de categoría de 3 letras sin repetir", () => {
    expect(suggestCategoryCode("Cocina", new Set())).toBe("COC");
    expect(suggestCategoryCode("Energía", new Set())).toBe("ENE");
    expect(suggestCategoryCode("Electrónica y Gadgets", new Set(["ELE"]))).toBe("EYG");
    expect(suggestCategoryCode("Cocina", new Set(["COC", "CXX"]))).toMatch(/^[A-Z]{3}$/);
  });

  it("la categoría recibe un código automático editable y único", async () => {
    const { token } = await createTestUser("ADMIN");
    const created = await request(app).post("/api/categories").set(auth(token)).send({ name: "Mascotas" });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe("MAS");
    const other = await request(app).post("/api/categories").set(auth(token)).send({ name: "Mascotas grandes", code: "mas" });
    expect(other.status).toBe(409); expect(other.body.field).toBe("code");
    await request(app).post("/api/categories").set(auth(token)).send({ name: "X", code: "A1" }).expect(400);
    const edited = await request(app).patch(`/api/categories/${created.body.id}`).set(auth(token)).send({ code: "pet" });
    expect(edited.body.code).toBe("PET");
  });

  it("SKU de producto: código de categoría + correlativo propio, inmutable", async () => {
    const { token } = await createTestUser("ADMIN");
    const cocina = await prisma.category.create({ data: { name: "Cocina", code: "COC" } });
    const energia = await prisma.category.create({ data: { name: "Energía", code: "ENE" } });
    const create = (categoryId: string, name: string) => request(app).post("/api/products").set(auth(token)).send({ name, categoryId });
    const results = await Promise.all([create(cocina.id, "A"), create(cocina.id, "B"), create(cocina.id, "C")]);
    expect(results.map((r) => r.body.sku).sort()).toEqual(["COC-0001", "COC-0002", "COC-0003"]);
    expect((await create(energia.id, "Linterna")).body.sku).toBe("ENE-0001");

    await request(app).post("/api/products").set(auth(token)).send({ name: "Manual", categoryId: cocina.id, sku: "MIO-1" }).expect(400);
    const moved = await request(app).patch(`/api/products/${results[0].body.id}`).set(auth(token)).send({ categoryId: energia.id });
    expect(moved.status).toBe(200);
    expect(moved.body.sku).toBe(results[0].body.sku); // no cambia al cambiar de categoría
    await request(app).patch(`/api/products/${results[0].body.id}`).set(auth(token)).send({ sku: "OTRO" }).expect(400);
  });

  it("SKU de variante: atributos abreviados; se recalcula solo antes del primer movimiento", async () => {
    const { token } = await createTestUser("ADMIN");
    const category = await prisma.category.create({ data: { name: "Cocina", code: "COC" } });
    const product = (await request(app).post("/api/products").set(auth(token)).send({ name: "Olla", categoryId: category.id })).body;
    const variant = await request(app).post(`/api/products/${product.id}/variants`).set(auth(token))
      .send({ attributes: { material: "Acero Inoxidable", capacidad: "5 L" } });
    expect(variant.body.sku).toBe("COC-0001-ACEROI-5L");
    const twin = await request(app).post(`/api/products/${product.id}/variants`).set(auth(token))
      .send({ attributes: { material: "Acero ionizado", capacidad: "5L" } });
    expect(twin.body.sku).toBe("COC-0001-ACEROI-5L-2");

    const renamed = await request(app).patch(`/api/variants/${variant.body.id}`).set(auth(token)).send({ attributes: { material: "Negro", capacidad: "5L" } });
    expect(renamed.body.sku).toBe("COC-0001-NEGRO-5L");

    const stocked = await createVariantWithIngreso({ productId: product.id, quantity: 1, unitCost: 1 });
    const kept = await request(app).patch(`/api/variants/${stocked.id}`).set(auth(token)).send({ attributes: { color: "Rojo" } });
    expect(kept.body.sku).toBe(stocked.sku);
    expect(kept.body.label).toBe("Rojo");
  });

  it("importaciones: IMP-000001 automático, contenedor aparte y buscable", async () => {
    const { token } = await createTestUser("ADMIN");
    const body = { containerType: "40", containerCbm: 70, arrivalDate: "2026-10-06" };
    await request(app).post("/api/import-batches").set(auth(token)).send({ ...body, reference: "MIA" }).expect(400);
    const first = await request(app).post("/api/import-batches").set(auth(token)).send({ ...body, containerNumber: "MSKU7654321" });
    const second = await request(app).post("/api/import-batches").set(auth(token)).send(body);
    expect([first.body.reference, second.body.reference]).toEqual(["IMP-000001", "IMP-000002"]);
    const found = await request(app).get("/api/import-batches?q=msku765").set(auth(token));
    expect(found.body.data.map((b: { reference: string }) => b.reference)).toEqual(["IMP-000001"]);
  });

  it("devoluciones y reclamos reciben DEV- y REC- correlativos", async () => {
    const { generateClaimCode, generateReturnCode } = await import("../src/lib/orderNumber");
    const codes = await prisma.$transaction(async (tx) => [await generateReturnCode(tx), await generateReturnCode(tx), await generateClaimCode(tx)]);
    expect(codes).toEqual(["DEV-000001", "DEV-000002", "REC-000001"]);
    expect((await createCategoryFixture()).category.code).toBeTruthy();
  });
});
