import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createCategoryFixture, createLocationFixture, createProductFixture, createTestUser, createVariantFixture, prisma, resetDatabase } from './helpers';
const app = createApp();
afterEach(resetDatabase);

async function fixture() {
  const { token, user } = await createTestUser('OPERATOR');
  const { category } = await createCategoryFixture();
  const product = await createProductFixture({ categoryId: category.id });
  const variant = await createVariantFixture({ productId: product.id, stock: 20 });
  const location = await createLocationFixture();
  const batch = await prisma.importBatch.create({ data: { reference: 'EDIT-RECEIPT', arrivalDate: new Date(), containerType: 'LCL', containerCbm: 2 } });
  const movement = await prisma.inventoryMovement.create({ data: { variantId: variant.id, importBatchId: batch.id, type: 'INGRESO', quantity: 20, stockAfter: 20, volumeCbm: 2, unitCost: 170, landedCostPerUnit: 31 } });
  const patch = (body: object, batchId = batch.id) => request(app).patch(`/api/import-batches/${batchId}/movements/${movement.id}`).set('Authorization', `Bearer ${token}`).send(body);
  return { user, variant, location, batch, movement, patch, token };
}

describe('Corrección de ubicación y datos físicos de ingresos', () => {
  it('asigna un ingreso sin ubicación, audita y conserva stock, CBM y costos', async () => {
    const { patch, location, variant, movement, user, token } = await fixture();
    const res = await patch({ locationId: location.id, dimensionsCm: '50x40x30', maxStackUnits: 3 });
    expect(res.status).toBe(200);
    expect(res.body.toLocationId).toBe(location.id);
    expect(res.body).not.toHaveProperty('unitCost');
    expect(res.body.variant).toMatchObject({ dimensionsCm: '50x40x30', maxStackUnits: 3 });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock).toBe(20);
    const saved = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } });
    expect(Number(saved.unitCost)).toBe(170);
    expect(Number(saved.landedCostPerUnit)).toBe(31);
    expect(Number(saved.volumeCbm)).toBe(2);
    expect(await prisma.inventoryMovement.count({ where: { variantId: variant.id } })).toBe(1);
    expect(await prisma.auditLog.findFirst({ where: { entityId: movement.id } })).toMatchObject({ performedById: user.id, action: 'UPDATE' });
    const stock = await request(app).get(`/api/inventory/stock-by-location?variantId=${variant.id}`).set('Authorization', `Bearer ${token}`);
    expect(stock.status).toBe(200);
    expect(stock.body.data[0]).toMatchObject({ netStock: 20, stackLayers: 3 });
    expect(stock.body.data[0].volumeCbm).toBeCloseTo(1.2);
    expect(stock.body.data[0].estimatedFloorAreaM2).toBeCloseTo(1.4);
  });
  it('bloquea una corrección que dejaría negativo el origen; permite editar dimensiones después de salidas', async () => {
    const { patch, location, variant, movement } = await fixture();
    await prisma.inventoryMovement.update({ where: { id: movement.id }, data: { toLocationId: location.id } });
    await prisma.inventoryMovement.create({ data: { variantId: variant.id, type: 'SALIDA', quantity: -5, stockAfter: 15, fromLocationId: location.id } });
    await prisma.productVariant.update({ where: { id: variant.id }, data: { stock: 15 } });
    const destination = await createLocationFixture();
    expect((await patch({ locationId: destination.id, dimensionsCm: '20x20x20' })).status).toBe(409);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).dimensionsCm).toBeNull();
    expect((await patch({ dimensionsCm: '20x20x20', maxStackUnits: 2 })).status).toBe(200);
  });
  it('rechaza ubicación inactiva, otro lote, campos de costo y datos físicos inválidos', async () => {
    const { patch, location } = await fixture();
    await prisma.location.update({ where: { id: location.id }, data: { isActive: false } });
    expect((await patch({ locationId: location.id })).status).toBe(400);
    expect((await patch({ dimensionsCm: '10x20x30' }, 'otro-lote')).status).toBe(404);
    for (const body of [{ dimensionsCm: '10x0x20' }, { dimensionsCm: 'texto' }, { maxStackUnits: 0 }, { maxStackUnits: 1.5 }, { unitCost: 1 }, {}]) {
      expect((await patch(body)).status).toBe(400);
    }
  });
});
