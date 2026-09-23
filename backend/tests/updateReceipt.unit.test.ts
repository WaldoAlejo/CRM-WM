import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('../src/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
import { updateReceipt, updateReceiptSchema } from '../src/modules/importBatches/updateReceipt';

const movement = { id: 'm', variantId: 'v', importBatchId: 'b', type: 'INGRESO', quantity: 20, toLocationId: null, unitCost: 170, landedCostPerUnit: 31, volumeCbm: 2 };
const variant = { id: 'v', stock: 20, dimensionsCm: null, maxStackUnits: 1, deletedAt: null };
function transaction() {
  return {
    inventoryMovement: {
      findFirst: vi.fn().mockResolvedValue(movement),
      aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 20 } }),
      update: vi.fn().mockImplementation(async ({ data }) => ({ ...movement, ...data })),
    },
    productVariant: { update: vi.fn().mockResolvedValue(variant) },
    dispatchOrderItem: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 0 } }) },
    location: { findFirst: vi.fn().mockResolvedValue({ id: 'l' }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
}
let tx: ReturnType<typeof transaction>;
beforeEach(() => { tx = transaction(); mocks.transaction.mockReset().mockImplementation(fn => fn(tx)); });

describe('Edición de ingreso, validación local sin base de datos', () => {
  it('guarda cartones por ingreso y audita el empaque sin modificar dimensiones de la variante', async () => {
    const packaging = { cartonCount: 5, unitsPerCarton: 4, maxStackCartons: 3, stackingConfirmed: false };
    const result = await updateReceipt('b', 'm', { packaging }, 'u', 'ADMIN');
    expect(result).toMatchObject({ packaging, quantity: 20, volumeCbm: 2 });
    expect(tx.productVariant.update).toHaveBeenLastCalledWith({ where: { id: 'v' }, data: { dimensionsCm: undefined, maxStackUnits: undefined } });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ changes: expect.objectContaining({ after: expect.objectContaining({ packaging }) }) }) }));
    await expect(updateReceipt('b', 'm', { packaging: { ...packaging, cartonCount: 6 } }, 'u', 'ADMIN')).rejects.toThrow('unidades ya recibidas');
  });
  it('asigna ubicación sin emitir un ingreso adicional ni cambiar costos', async () => {
    const result = await updateReceipt('b', 'm', { locationId: 'l' }, 'u', 'OPERATOR');
    expect(result).toMatchObject({ toLocationId: 'l', quantity: 20, volumeCbm: 2 });
    expect(result).not.toHaveProperty('unitCost');
    expect(result).not.toHaveProperty('landedCostPerUnit');
    expect(tx.inventoryMovement.update).toHaveBeenCalledWith(expect.objectContaining({ data: { toLocationId: 'l' } }));
    expect(tx.productVariant.update.mock.calls[0][0].data).toEqual({ stock: { increment: 0 } });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ performedById: 'u', entityId: 'm', action: 'UPDATE' }) }));
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });
  it.each([['despachadas', 15, 0], ['reservadas', 20, 1]])('rechaza unidades %s antes de cambiar la ubicación', async (_, quantity, reserved) => {
    tx.inventoryMovement.aggregate.mockResolvedValue({ _sum: { quantity } });
    tx.dispatchOrderItem.aggregate.mockResolvedValue({ _sum: { quantity: reserved } });
    await expect(updateReceipt('b', 'm', { locationId: 'l' }, 'u', 'ADMIN')).rejects.toThrow('No se puede reasignar');
    expect(tx.inventoryMovement.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('permite modificar dimensiones aunque el ingreso ya tenga salidas', async () => {
    tx.inventoryMovement.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    await updateReceipt('b', 'm', { dimensionsCm: '50x40x30', maxStackUnits: 3 }, 'u', 'ADMIN');
    expect(tx.productVariant.update).toHaveBeenLastCalledWith({ where: { id: 'v' }, data: { dimensionsCm: '50x40x30', maxStackUnits: 3 } });
    expect(tx.inventoryMovement.aggregate).not.toHaveBeenCalled();
  });
  it('rechaza ubicaciones no elegibles y movimientos que no pertenecen al lote', async () => {
    tx.location.findFirst.mockResolvedValue(null);
    await expect(updateReceipt('b', 'm', { locationId: 'l' }, 'u', 'ADMIN')).rejects.toThrow('ubicación activa');
    expect(tx.location.findFirst).toHaveBeenCalledWith({ where: { id: 'l', isActive: true, type: 'STANDARD', warehouse: { isActive: true } } });
    tx.inventoryMovement.findFirst.mockResolvedValue(null);
    await expect(updateReceipt('b', 'm', { dimensionsCm: null }, 'u', 'ADMIN')).rejects.toThrow('Ingreso no encontrado');
  });
  it('devuelve un conflicto recuperable si cambia el inventario concurrentemente', async () => {
    mocks.transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('serialization', { code: 'P2034', clientVersion: '6' }));
    await expect(updateReceipt('b', 'm', { locationId: 'l' }, 'u', 'ADMIN')).rejects.toThrow('El inventario cambió');
  });
  it('valida dimensiones, límites de apilamiento y campos permitidos', () => {
    for (const data of [{}, { unitCost: 1 }, { dimensionsCm: '50x0x10' }, { dimensionsCm: 'texto' }, { maxStackUnits: 0 }, { maxStackUnits: 1.5 }, { maxStackUnits: 1001 }]) {
      expect(updateReceiptSchema.safeParse(data).success).toBe(false);
    }
    expect(updateReceiptSchema.safeParse({ dimensionsCm: '50,5 × 40 × 30', maxStackUnits: 3 }).success).toBe(true);
  });
});
