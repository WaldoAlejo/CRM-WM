import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTestUser, createCategoryFixture, createProductFixture, createVariantFixture, prisma, resetDatabase } from './helpers';
import { newSpatialLayout, toSpatialLayout, type SpatialLayout, type StorageElement } from '../src/modules/warehouses/warehouseSpatialCore';

const app = createApp();
afterEach(resetDatabase);
function plan(): SpatialLayout {
  const storage: StorageElement = { id: 'floor1', name: 'Ubicación 1', type: 'STORAGE', code: 'UB1', x: 1, y: 1, width: 2.4, depth: 1, rotation: 0, mode: 'FLOOR', palletWidthM: 1.2, palletDepthM: 1, gapM: 0, levels: 1, levelHeightM: 1.5, slots: [{ row: 0, column: 0 }, { row: 0, column: 1 }], intendedUse: 'Power stations' };
  return { ...newSpatialLayout(), elements: [storage, { ...storage, id: 'floor2', name: 'Ubicación 2', code: 'UB2', x: 5, width: 1.2, slots: [{ row: 0, column: 0 }] }, { id: 'desk', type: 'DESK', name: 'Mesa de despacho', x: 1, y: 5, width: 2, depth: 1, rotation: 0 }] };
}

describe('Persistencia del plano espacial', () => {
  it('persiste ubicaciones agrupadas, calcula capacidad y no crea inventario para mobiliario', async () => {
    const { token } = await createTestUser('ADMIN');
    const layout = plan();
    const create = await request(app).post('/api/warehouses').set('Authorization', `Bearer ${token}`).send({ name: 'Bodega con espacios', capacity: 9000, layout });
    expect(create.status).toBe(201); expect(create.body.capacity).toBe(3);
    expect(create.body.locations.map((l: { code: string }) => l.code).sort()).toEqual(['UB1', 'UB2']);
    const saved = await prisma.warehouse.findUniqueOrThrow({ where: { id: create.body.id }, include: { locations: true } });
    expect(saved.layout).toEqual(layout); expect(saved.locations).toHaveLength(3);
    const again = await request(app).patch(`/api/warehouses/${saved.id}`).set('Authorization', `Bearer ${token}`).send({ layout });
    expect(again.status).toBe(200);
    expect(again.body.locations.map((l: { id: string }) => l.id).sort()).toEqual(create.body.locations.map((l: { id: string }) => l.id).sort());
    const metadataOnly = await request(app).patch(`/api/warehouses/${saved.id}`).set('Authorization', `Bearer ${token}`).send({ capacity: 999 });
    expect(metadataOnly.body.capacity).toBe(3);
  });
  it('permite recibir en grupo y bloquea mover, renombrar el código o quitar la ubicación usada', async () => {
    const { token } = await createTestUser('ADMIN');
    const layout = plan();
    const created = await request(app).post('/api/warehouses').set('Authorization', `Bearer ${token}`).send({ name: 'Stock agrupado', layout });
    expect(created.status).toBe(201);
    const location = created.body.locations.find((l: { code: string }) => l.code === 'UB1');
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const variant = await createVariantFixture({ productId: product.id });
    const batch = await prisma.importBatch.create({ data: { reference: 'SPATIAL-IMPORT', arrivalDate: new Date(), containerType: 'LCL', containerCbm: 1 } });
    const receipt = await request(app).post(`/api/import-batches/${batch.id}/receive`).set('Authorization', `Bearer ${token}`).send({ lines: [{ variantId: variant.id, quantity: 20, unitCost: 10, volumeCbm: 1, locationId: location.id }] });
    expect(receipt.status).toBe(201);
    for (const mutate of [
      (p: SpatialLayout) => { p.elements[0].y = 3; },
      (p: SpatialLayout) => { (p.elements[0] as StorageElement).code = 'OTRO'; },
      (p: SpatialLayout) => { p.elements.shift(); },
      (p: SpatialLayout) => { (p.elements[0] as StorageElement).slots.pop(); },
    ]) {
      const modified = structuredClone(layout); mutate(modified);
      const update = await request(app).patch(`/api/warehouses/${created.body.id}`).set('Authorization', `Bearer ${token}`).send({ name: 'No guardar', layout: modified });
      expect(update.status).toBe(409);
      expect((await prisma.warehouse.findUniqueOrThrow({ where: { id: created.body.id } })).name).toBe('Stock agrupado');
    }
    const renamed = structuredClone(layout); renamed.elements[0].name = 'Zona de energía';
    const good = await request(app).patch(`/api/warehouses/${created.body.id}`).set('Authorization', `Bearer ${token}`).send({ layout: renamed });
    expect(good.status).toBe(200);
    expect(good.body.locations.find((l: { code: string }) => l.code === 'UB1').id).toBe(location.id);
  });
  it('rechaza geometría inválida sin aplicar otros cambios y conserva Cuarentena', async () => {
    const { token } = await createTestUser('ADMIN');
    const created = await request(app).post('/api/warehouses').set('Authorization', `Bearer ${token}`).send({ name: 'Plano estable', layout: plan() });
    expect(created.status).toBe(201);
    const quarantine = await prisma.location.findFirstOrThrow({ where: { warehouseId: created.body.id, type: 'CUARENTENA' } });
    const invalid = plan(); invalid.elements[2].y = 1;
    const result = await request(app).patch(`/api/warehouses/${created.body.id}`).set('Authorization', `Bearer ${token}`).send({ name: 'Inválida', layout: invalid });
    expect(result.status).toBe(400);
    expect((await prisma.warehouse.findUniqueOrThrow({ where: { id: created.body.id } })).name).toBe('Plano estable');
    expect(await prisma.location.findUnique({ where: { id: quarantine.id } })).toEqual(quarantine);
  });
  it('convierte rack anterior con movimientos conservando exactamente sus IDs e historial', async () => {
    const { token } = await createTestUser('ADMIN');
    const legacy = { lengthM: 6, widthM: 4, heightM: 6, cellLengthM: 1.2, cellWidthM: 1, hasRacks: true, rackLevels: 3, levelHeightM: 1.5, positions: [{ row: 1, column: 1 }] };
    const created = await request(app).post('/api/warehouses').set('Authorization', `Bearer ${token}`).send({ name: 'Rack anterior', layout: legacy });
    expect(created.status).toBe(201);
    const { category } = await createCategoryFixture(); const product = await createProductFixture({ categoryId: category.id }); const variant = await createVariantFixture({ productId: product.id });
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, type: 'INGRESO', quantity: 1, stockAfter: 1, toLocationId: created.body.locations[0].id } });
    const converted = await request(app).patch(`/api/warehouses/${created.body.id}`).set('Authorization', `Bearer ${token}`).send({ layout: toSpatialLayout(legacy) });
    expect(converted.status).toBe(200);
    expect(converted.body.locations.map((l: { id: string }) => l.id).sort()).toEqual(created.body.locations.map((l: { id: string }) => l.id).sort());
    expect(converted.body.capacity).toBe(created.body.capacity);
  });
});
