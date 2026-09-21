import { LocationType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { conflict, notFound } from "../../utils/httpError";

// `Warehouse.name` es un @unique normal (no parcial): igual que Courier, este
// modelo no tiene `deletedAt` — usa `isActive` como su equivalente de soft
// delete, así que no aplica el patrón de índice único parcial de
// Supplier/Brand (ver comentario en schema.prisma).
function mapUniqueConstraintError(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw conflict("Ya existe una bodega con ese nombre", { field: "name" });
  }
  throw err;
}

export async function listWarehouses() {
  return prisma.warehouse.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    include: {
      locations: { where: { isActive: true, type: LocationType.STANDARD }, orderBy: { code: "asc" } },
    },
  });
}

export async function getWarehouseById(id: string) {
  const warehouse = await prisma.warehouse.findFirst({
    where: { id, isActive: true },
    include: {
      locations: { where: { isActive: true, type: LocationType.STANDARD }, orderBy: { code: "asc" } },
    },
  });
  if (!warehouse) throw notFound("Bodega no encontrada");
  return warehouse;
}

interface WarehouseInput {
  name?: string;
  address?: string;
}

export async function createWarehouse(data: WarehouseInput) {
  try {
    // Toda bodega nace con su ubicación de Cuarentena/Validación (una por
    // bodega): sin ella el módulo de Consignación y las devoluciones de courier
    // no tendrían dónde dejar las unidades a validar.
    const warehouse = await prisma.warehouse.create({
      data: {
        name: data.name!,
        address: data.address,
        locations: { create: { code: "Cuarentena", type: LocationType.CUARENTENA } },
      },
      include: { locations: { where: { type: LocationType.STANDARD } } },
    });
    return warehouse;
  } catch (err) {
    mapUniqueConstraintError(err);
  }
}

export async function updateWarehouse(id: string, data: WarehouseInput) {
  await getWarehouseById(id); // valida que exista y esté activa

  try {
    return await prisma.warehouse.update({ where: { id }, data });
  } catch (err) {
    mapUniqueConstraintError(err);
  }
}

// No se puede desactivar una bodega si todavía tiene ubicaciones activas
// colgando de ella: el usuario debe desactivarlas (o reasignarlas) primero,
// mismo criterio que Category frente a sus Subcategory activas.
export async function deactivateWarehouse(id: string) {
  const warehouse = await getWarehouseById(id);

  const locationCount = await prisma.location.count({
    where: { warehouseId: id, isActive: true, type: LocationType.STANDARD },
  });
  if (locationCount > 0) {
    throw conflict(
      `No se puede eliminar: hay ${locationCount} ubicación(es) activas en esta bodega. Elimínalas primero.`
    );
  }

  // La Cuarentena se da de baja junto con la bodega, pero solo si no quedan
  // unidades esperando checklist (perderían su lugar de validación).
  const pendingInQuarantine = await prisma.returnLine.count({
    where: { quarantineLocation: { warehouseId: id }, batch: { completedAt: null } },
  });
  if (pendingInQuarantine > 0) {
    throw conflict(
      `No se puede eliminar: hay devoluciones pendientes de checklist en la Cuarentena de esta bodega (${pendingInQuarantine} línea(s)).`
    );
  }

  const [, updated] = await prisma.$transaction([
    prisma.location.updateMany({
      where: { warehouseId: id, type: LocationType.CUARENTENA, isActive: true },
      data: { isActive: false },
    }),
    prisma.warehouse.update({ where: { id: warehouse.id }, data: { isActive: false } }),
  ]);
  return updated;
}
