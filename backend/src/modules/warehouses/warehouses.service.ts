import { Prisma } from "@prisma/client";
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
      locations: { where: { isActive: true }, orderBy: { code: "asc" } },
    },
  });
}

export async function getWarehouseById(id: string) {
  const warehouse = await prisma.warehouse.findFirst({
    where: { id, isActive: true },
    include: {
      locations: { where: { isActive: true }, orderBy: { code: "asc" } },
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
    return await prisma.warehouse.create({ data: { name: data.name!, address: data.address } });
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
    where: { warehouseId: id, isActive: true },
  });
  if (locationCount > 0) {
    throw conflict(
      `No se puede eliminar: hay ${locationCount} ubicación(es) activas en esta bodega. Elimínalas primero.`
    );
  }

  return prisma.warehouse.update({ where: { id: warehouse.id }, data: { isActive: false } });
}
