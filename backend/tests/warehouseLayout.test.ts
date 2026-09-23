import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createTestUser, createLocationFixture, createCategoryFixture, createProductFixture, createVariantFixture, prisma, resetDatabase } from "./helpers";
import { warehouseLayoutSchema, layoutLocations } from "../src/modules/warehouses/warehouseLayout";

const app = createApp();
afterEach(resetDatabase);
const floor = { lengthM: 6, widthM: 4, heightM: 5, cellLengthM: 1.2, cellWidthM: 1, hasRacks: false, rackLevels: 1, levelHeightM: 1.5, positions: [{ row: 0, column: 0 }, { row: 1, column: 2 }] };

describe("Plano de bodega", () => {
  it("crea posiciones reales con códigos y calcula capacidad sin confiar en el cliente", async () => {
    const { token } = await createTestUser("ADMIN");
    const res = await request(app).post("/api/warehouses").set("Authorization", `Bearer ${token}`).send({ name: "Plano piso", layout: floor, capacity: 999 });
    expect(res.status).toBe(201);
    expect(res.body.capacity).toBe(2);
    expect(res.body.layout).toEqual(floor);
    expect(res.body.locations.map((l: { code: string }) => l.code).sort()).toEqual(["P-01-01", "P-02-03"]);
    expect(await prisma.location.count({ where: { warehouseId: res.body.id, type: "CUARENTENA" } })).toBe(1);
  });
  it("crea niveles de rack y permite recibir inventario en una posición generada", async () => {
    const { token } = await createTestUser("ADMIN");
    const layout = { ...floor, hasRacks: true, rackLevels: 3 };
    const res = await request(app).post("/api/warehouses").set("Authorization", `Bearer ${token}`).send({ name: "Racks", layout });
    expect(res.status).toBe(201); expect(res.body.capacity).toBe(6);
    expect(res.body.locations.some((l: { code: string }) => l.code === "R-02-03-N03")).toBe(true);
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const variant = await createVariantFixture({ productId: product.id });
    const batch = await prisma.importBatch.create({ data: { reference: "RACK-IMPORT", arrivalDate: new Date(), containerType: "LCL", containerCbm: 1 } });
    const receipt = await request(app).post(`/api/import-batches/${batch.id}/receive`).set("Authorization", `Bearer ${token}`).send({ lines: [{ variantId: variant.id, quantity: 5, unitCost: 10, volumeCbm: 1, locationId: res.body.locations[0].id }] });
    expect(receipt.status).toBe(201); expect(receipt.body.movements[0].toLocationId).toBe(res.body.locations[0].id);
  });
  it("edita sin duplicar IDs, conserva ubicaciones manuales y Cuarentena", async () => {
    const { token } = await createTestUser("ADMIN");
    const manual = await createLocationFixture();
    const quarantine = await prisma.location.findFirstOrThrow({ where: { warehouseId: manual.warehouseId, type: "CUARENTENA" } });
    const edit = (layout: typeof floor) => request(app).patch(`/api/warehouses/${manual.warehouseId}`).set("Authorization", `Bearer ${token}`).send({ layout });
    const first = await edit(floor); expect(first.status).toBe(200);
    const ids = first.body.locations.map((l: { id: string }) => l.id).sort();
    const again = await edit(floor); expect(again.status).toBe(200);
    expect(again.body.locations.map((l: { id: string }) => l.id).sort()).toEqual(ids);
    const smaller = await edit({ ...floor, positions: [floor.positions[0]] }); expect(smaller.status).toBe(200);
    expect(smaller.body.locations).toHaveLength(2); // una manual y una del plano
    expect(await prisma.location.findUnique({ where: { id: quarantine.id } })).toEqual(quarantine);
    expect(await prisma.location.findUnique({ where: { id: manual.id } })).toEqual(manual);
  });
  it("no reemplaza ubicaciones manuales con un código coincidente y revierte todo", async () => {
    const { token } = await createTestUser("ADMIN");
    const manual = await createLocationFixture({ code: "P-01-01" });
    const res = await request(app).patch(`/api/warehouses/${manual.warehouseId}`).set("Authorization", `Bearer ${token}`).send({ name: "No guardar", layout: floor });
    expect(res.status).toBe(409);
    expect((await prisma.warehouse.findUniqueOrThrow({ where: { id: manual.warehouseId } })).layout).toBeNull();
    expect(await prisma.location.count({ where: { warehouseId: manual.warehouseId } })).toBe(2);
  });
  it("bloquea quitar una posición usada y bloquea modificarla fuera del plano", async () => {
    const { token } = await createTestUser("ADMIN");
    const created = await request(app).post("/api/warehouses").set("Authorization", `Bearer ${token}`).send({ name: "Usada", layout: floor });
    const location = created.body.locations[0];
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const variant = await createVariantFixture({ productId: product.id });
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, type: "INGRESO", quantity: 1, stockAfter: 1, toLocationId: location.id } });
    const result = await request(app).patch(`/api/warehouses/${created.body.id}`).set("Authorization", `Bearer ${token}`).send({ name: "No guardar", layout: { ...floor, positions: [] } });
    expect(result.status).toBe(409);
    const resized = await request(app).patch(`/api/warehouses/${created.body.id}`).set("Authorization", `Bearer ${token}`).send({ layout: { ...floor, cellLengthM: 1 } });
    expect(resized.status).toBe(409);
    expect((await prisma.warehouse.findUniqueOrThrow({ where: { id: created.body.id } })).name).toBe("Usada");
    expect(await prisma.location.count({ where: { warehouseId: created.body.id } })).toBe(3);
    expect((await request(app).patch(`/api/locations/${location.id}`).set("Authorization", `Bearer ${token}`).send({ code: "Cambiar" })).status).toBe(409);
    expect((await request(app).delete(`/api/locations/${location.id}`).set("Authorization", `Bearer ${token}`)).status).toBe(409);
  });
  it.each([
    { lengthM: 0 }, { widthM: -1 }, { cellWidthM: 0 }, { lengthM: 200 },
    { positions: [{ row: 5, column: 0 }] }, { positions: [floor.positions[0], floor.positions[0]] },
    { hasRacks: true, rackLevels: 4, levelHeightM: 2 }, { rackLevels: 1.5 },
  ])("valida dimensiones, límites y altura: %j", invalid => {
    expect(warehouseLayoutSchema.safeParse({ ...floor, ...invalid }).success).toBe(false);
  });
  it("admite medidas decimales exactas en el borde del plano", () => {
    const layout = { ...floor, lengthM: 3.6, positions: [{ row: 2, column: 0 }] };
    expect(warehouseLayoutSchema.safeParse(layout).success).toBe(true);
    expect(layoutLocations(layout)[0].code).toBe("P-03-01");
  });
});
