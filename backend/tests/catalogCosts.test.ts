import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createCategoryFixture, createProductFixture, createVariantFixture, createTestUser, prisma, resetDatabase } from './helpers';
const app = createApp();
afterEach(resetDatabase);

describe('Costos ponderados del catálogo', () => {
  it('pondera por unidades de ingreso, incluye gastos, no usa fábrica ni promedio simple de variantes', async () => {
    const { token } = await createTestUser('ADMIN');
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const v1 = await createVariantFixture({ productId: product.id });
    const v2 = await createVariantFixture({ productId: product.id });
    const noReceipts = await createVariantFixture({ productId: product.id });
    await prisma.productVariant.updateMany({ where: { productId: product.id }, data: { costPriceUSD: 170 } });
    await prisma.inventoryMovement.createMany({ data: [
      { variantId: v1.id, type: 'INGRESO', quantity: 20, stockAfter: 20, unitCost: 170, landedCostPerUnit: 31 },
      { variantId: v1.id, type: 'INGRESO', quantity: 10, stockAfter: 30, unitCost: 200, landedCostPerUnit: 10 },
      { variantId: v1.id, type: 'SALIDA', quantity: -25, stockAfter: 5, unitCost: 9999 },
      { variantId: v2.id, type: 'INGRESO', quantity: 70, stockAfter: 70, unitCost: 100, landedCostPerUnit: 20 },
    ] });
    const detail = await request(app).get(`/api/products/${product.id}`).set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.variants.find((v: { id: string }) => v.id === v1.id).weightedAverageCost).toBe('204.00');
    expect(detail.body.variants.find((v: { id: string }) => v.id === v2.id).weightedAverageCost).toBe('120.00');
    expect(detail.body.variants.find((v: { id: string }) => v.id === noReceipts.id).weightedAverageCost).toBeNull();
    expect(detail.body.weightedAverageCost).toBe('145.20');
    const list = await request(app).get('/api/products').set('Authorization', `Bearer ${token}`);
    expect(list.body.data.find((p: { id: string }) => p.id === product.id).weightedAverageCost).toBe('145.20');
    const pricing = await request(app).get(`/api/dispatch-orders/pricing/${v1.id}`).set('Authorization', `Bearer ${token}`);
    expect(Number(pricing.body.realCost)).toBe(204);
    const operator = await createTestUser('OPERATOR');
    const hidden = await request(app).get(`/api/products/${product.id}`).set('Authorization', `Bearer ${operator.token}`);
    expect(hidden.body).not.toHaveProperty('weightedAverageCost');
    for (const v of hidden.body.variants) {
      expect(v).not.toHaveProperty('weightedAverageCost');
      expect(v).not.toHaveProperty('costPriceUSD');
    }
    const hiddenList = await request(app).get('/api/products').set('Authorization', `Bearer ${operator.token}`);
    expect(hiddenList.body.data[0]).not.toHaveProperty('weightedAverageCost');
  });
  it('muestra cero real y null sin ingresos, excluyendo variantes eliminadas', async () => {
    const { token } = await createTestUser('CEO');
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const empty = await createProductFixture({ categoryId: category.id });
    const free = await createVariantFixture({ productId: product.id });
    const deleted = await createVariantFixture({ productId: product.id });
    await prisma.inventoryMovement.createMany({ data: [
      { variantId: free.id, type: 'INGRESO', quantity: 5, stockAfter: 5, unitCost: 0 },
      { variantId: deleted.id, type: 'INGRESO', quantity: 100, stockAfter: 100, unitCost: 1000 },
    ] });
    await prisma.productVariant.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    const list = await request(app).get('/api/products').set('Authorization', `Bearer ${token}`);
    expect(list.body.data.find((p: { id: string }) => p.id === product.id).weightedAverageCost).toBe('0.00');
    expect(list.body.data.find((p: { id: string }) => p.id === empty.id).weightedAverageCost).toBeNull();
  });
});
