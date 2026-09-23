import { Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { parseDimensions } from '../../lib/storageVolume';
import { badRequest, conflict, notFound } from '../../utils/httpError';
import { serializeMovementForRole } from '../inventory/inventory.movementSerializer';
import { cartonPackagingSchema } from './cartonPackaging.schema';

export const updateReceiptSchema = z.object({
  packaging: cartonPackagingSchema.nullable().optional(),
  locationId: z.string().min(1).nullable().optional(),
  dimensionsCm: z.string().max(50).refine(v => parseDimensions(v) !== null, 'Usa largo x ancho x alto en cm, por ejemplo 50x40x30').nullable().optional(),
  maxStackUnits: z.number().int().min(1).max(1000).optional(),
}).strict().refine(data => Object.keys(data).length > 0, 'Indica los datos que deseas modificar');

export async function updateReceipt(batchId: string, movementId: string, data: z.infer<typeof updateReceiptSchema>, userId: string, role: Role) {
  try {
    return await prisma.$transaction(async tx => {
      const movement = await tx.inventoryMovement.findFirst({ where: { id: movementId, importBatchId: batchId, type: 'INGRESO' } });
      if (!movement) throw notFound('Ingreso no encontrado en este lote');
      if (data.packaging && data.packaging.cartonCount * data.packaging.unitsPerCarton !== movement.quantity) {
        throw badRequest('Cartones × unidades por cartón debe coincidir con las unidades ya recibidas. Esta edición no cambia existencias.');
      }
      // The same row lock is taken by stock/reservation writers.
      const variant = await tx.productVariant.update({ where: { id: movement.variantId }, data: { stock: { increment: 0 } } });
      if (variant.deletedAt) throw notFound('Variante no encontrada');
      if (data.locationId !== undefined && data.locationId !== movement.toLocationId) {
        if (data.locationId) {
          const destination = await tx.location.findFirst({ where: { id: data.locationId, isActive: true, type: 'STANDARD', warehouse: { isActive: true } } });
          if (!destination) throw badRequest('Selecciona una ubicación activa de bodega');
        }
        // Correcting a receipt reassigns its entire quantity, never creates stock.
        // Protect units already dispatched or reserved at the original location.
        const source = movement.toLocationId;
        const balance = await tx.inventoryMovement.aggregate({ where: {
          variantId: movement.variantId,
          ...(source ? { OR: [{ toLocationId: source }, { fromLocationId: source }] } : { toLocationId: null, fromLocationId: null }),
        }, _sum: { quantity: true } });
        const reserved = await tx.dispatchOrderItem.aggregate({ where: { variantId: movement.variantId, locationId: source, dispatchOrder: { status: 'PENDIENTE' } }, _sum: { quantity: true } });
        if ((balance._sum.quantity ?? 0) - (reserved?._sum.quantity ?? 0) < movement.quantity) {
          throw conflict('No se puede reasignar todo el ingreso: hay unidades despachadas o reservadas en su ubicación original. Las dimensiones sí pueden editarse por separado.');
        }
      }
      const updatedVariant = await tx.productVariant.update({ where: { id: variant.id }, data: {
        dimensionsCm: data.dimensionsCm, maxStackUnits: data.maxStackUnits,
      } });
      const updated = await tx.inventoryMovement.update({ where: { id: movementId }, data: { toLocationId: data.locationId,
        ...(data.packaging !== undefined && { packaging: data.packaging === null ? Prisma.DbNull : { ...data.packaging } }),
      },
        include: { variant: { select: { sku: true, label: true, productId: true, dimensionsCm: true, maxStackUnits: true } } } });
      await tx.auditLog.create({ data: { entityType: 'InventoryMovement', entityId: movementId, action: 'UPDATE', performedById: userId,
        changes: { variantId: variant.id, before: { packaging: movement.packaging ?? null, locationId: movement.toLocationId, dimensionsCm: variant.dimensionsCm, maxStackUnits: variant.maxStackUnits },
          after: { packaging: updated.packaging ?? null, locationId: updated.toLocationId, dimensionsCm: updatedVariant.dimensionsCm, maxStackUnits: updatedVariant.maxStackUnits } } } });
      return serializeMovementForRole(updated, role);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') throw conflict('El inventario cambió mientras editabas. Actualiza y vuelve a guardar.');
    throw error;
  }
}
