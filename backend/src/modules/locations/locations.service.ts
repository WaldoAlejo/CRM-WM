import { DispatchStatus, LocationType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { conflict, notFound } from "../../utils/httpError";

async function assertWarehouseExists(warehouseId: string) {
  const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, isActive: true } });
  if (!warehouse) throw notFound("Bodega no encontrada");
  return warehouse;
}

async function getLocationOrThrow(id: string) {
  const location = await prisma.location.findFirst({
    where: { id, isActive: true, type: LocationType.STANDARD },
  });
  if (!location) throw notFound("Ubicación no encontrada");
  return location;
}

function mapUniqueConstraintError(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw conflict("Ya existe una ubicación con ese código en esta bodega", { field: "code" });
  }
  throw err;
}

export async function listLocationsByWarehouse(warehouseId: string) {
  await assertWarehouseExists(warehouseId);
  return prisma.location.findMany({
    where: { warehouseId, isActive: true, type: LocationType.STANDARD },
    orderBy: { code: "asc" },
  });
}

interface LocationInput {
  code?: string;
  aisle?: string;
  shelf?: string;
  level?: string;
}

export async function createLocation(warehouseId: string, data: LocationInput) {
  await assertWarehouseExists(warehouseId);
  try {
    return await prisma.location.create({ data: { ...data, code: data.code!, warehouseId } });
  } catch (err) {
    mapUniqueConstraintError(err);
  }
}

export async function updateLocation(id: string, data: LocationInput) {
  await getLocationOrThrow(id);
  try {
    return await prisma.location.update({ where: { id }, data });
  } catch (err) {
    mapUniqueConstraintError(err);
  }
}

// Protección de borrado, igual que el resto del catálogo pero con dos
// chequeos (no uno): stock actual y compromisos activos todavía no
// aplicados al ledger.
// 1) Stock neto en esta ubicación (agregado del ledger: suma de `quantity`
//    de todo movimiento donde esta ubicación fue origen o destino — nunca es
//    ambas cosas a la vez en el mismo movimiento, ver applyMovement) debe
//    ser 0. Los movimientos históricos NO bloquean el borrado por sí solos
//    (son historial inmutable, igual que ImportBatch/Shipment frente a
//    Supplier/Courier) — lo que bloquea es que todavía quede stock ahí.
// 2) Ítems de órdenes PENDIENTE que ya eligieron esta ubicación como origen:
//    todavía no generaron su movimiento de SALIDA (eso pasa recién al
//    confirmar), así que el chequeo de stock de arriba no los ve. Sin este
//    segundo chequeo se podría desactivar una ubicación con despachos en
//    camino que dependen de ella.
export async function deactivateLocation(id: string) {
  const location = await getLocationOrThrow(id);

  const [stockAgg, pendingItemCount] = await Promise.all([
    prisma.inventoryMovement.aggregate({
      where: { OR: [{ fromLocationId: id }, { toLocationId: id }] },
      _sum: { quantity: true },
    }),
    prisma.dispatchOrderItem.count({
      where: {
        locationId: id,
        dispatchOrder: { status: DispatchStatus.PENDIENTE, deletedAt: null },
      },
    }),
  ]);

  const netStock = stockAgg._sum.quantity ?? 0;
  if (netStock !== 0) {
    throw conflict(
      `No se puede eliminar: esta ubicación todavía tiene stock registrado (${netStock} unidades). Muévelo primero.`
    );
  }
  if (pendingItemCount > 0) {
    throw conflict(
      `No se puede eliminar: hay ${pendingItemCount} ítem(s) de órdenes pendientes que usan esta ubicación como origen.`
    );
  }

  return prisma.location.update({ where: { id: location.id }, data: { isActive: false } });
}
