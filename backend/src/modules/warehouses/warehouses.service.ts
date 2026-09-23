import { layoutVolumeCbm } from "./warehouseSpatialCore";
import { LocationType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { WAREHOUSE_MANAGER_ROLES } from "../../lib/roles";
import { badRequest, conflict, notFound } from "../../utils/httpError";
import { layoutCapacity, layoutLocations, syncWarehouseLayout, WarehouseLayout } from "./warehouseLayout";

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

// Campos del responsable que se exponen: nunca el email/hash — acá alcanza
// con identificarlo y saber su rol para mostrarlo en el listado/detalle.
const MANAGER_SELECT = { id: true, name: true, role: true } satisfies Prisma.UserSelect;

// managerId es opcional, pero si viene debe ser un usuario ACTIVO con un rol
// elegible (WAREHOUSE_MANAGER_ROLES) — nunca se asigna como responsable a
// alguien ya inactivo o a un rol fuera de esa lista.
async function assertValidManager(managerId: string | null | undefined) {
  if (!managerId) return;
  const manager = await prisma.user.findUnique({ where: { id: managerId }, select: { isActive: true, role: true } });
  if (!manager) throw badRequest("El responsable indicado no existe", { field: "managerId" });
  if (!manager.isActive) {
    throw badRequest("El responsable indicado no está activo", { field: "managerId" });
  }
  if (!WAREHOUSE_MANAGER_ROLES.includes(manager.role)) {
    throw badRequest(`El responsable debe tener rol ${WAREHOUSE_MANAGER_ROLES.join("/")}`, { field: "managerId" });
  }
}

export async function listWarehouses() {
  const warehouses = await prisma.warehouse.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    include: {
      locations: { where: { isActive: true, type: LocationType.STANDARD }, orderBy: { code: "asc" } },
      manager: { select: MANAGER_SELECT },
    },
  });
  return warehouses.map(w => ({ ...w, capacityCbm: w.layout ? layoutVolumeCbm(w.layout as WarehouseLayout) : w.capacityCbm }));
}

export async function getWarehouseById(id: string) {
  const warehouse = await prisma.warehouse.findFirst({
    where: { id, isActive: true },
    include: {
      locations: { where: { isActive: true, type: LocationType.STANDARD }, orderBy: { code: "asc" } },
      manager: { select: MANAGER_SELECT },
    },
  });
  if (!warehouse) throw notFound("Bodega no encontrada");
  return { ...warehouse, capacityCbm: warehouse.layout ? layoutVolumeCbm(warehouse.layout as WarehouseLayout) : warehouse.capacityCbm };
}

interface WarehouseInput {
  capacityCbm?: number | null;
  layout?: WarehouseLayout;
  name?: string;
  address?: string | null;
  capacity?: number | null;
  phone?: string | null;
  notes?: string | null;
  managerId?: string | null;
}

export async function createWarehouse(data: WarehouseInput) {
  await assertValidManager(data.managerId);

  try {
    // Toda bodega nace con su ubicación de Cuarentena/Validación (una por
    // bodega): sin ella el módulo de Consignación y las devoluciones de courier
    // no tendrían dónde dejar las unidades a validar.
    const warehouse = await prisma.warehouse.create({
      data: {
        name: data.name!,
        address: data.address,
        capacityCbm: data.layout ? layoutVolumeCbm(data.layout) : data.capacityCbm,
        capacity: data.layout ? layoutCapacity(data.layout) : data.capacity,
        layout: data.layout,
        phone: data.phone,
        notes: data.notes,
        managerId: data.managerId,
        locations: { create: [{ code: "Cuarentena", type: LocationType.CUARENTENA }, ...(data.layout ? layoutLocations(data.layout) : [])] },
      },
      include: { locations: { where: { type: LocationType.STANDARD } }, manager: { select: MANAGER_SELECT } },
    });
    return warehouse;
  } catch (err) {
    mapUniqueConstraintError(err);
  }
}

export async function updateWarehouse(id: string, data: WarehouseInput) {
  await getWarehouseById(id); // valida que exista y esté activa
  await assertValidManager(data.managerId);

  try {
    return await prisma.$transaction(async tx => {
      // Serialize concurrent edits of the same plan in the configured DB schema.
      const warehouse = await tx.warehouse.update({ where: { id }, data: { id } });
      if (data.layout) await syncWarehouseLayout(tx, id, data.layout, warehouse.layout as WarehouseLayout | null);
      const layout = data.layout ?? warehouse.layout as WarehouseLayout | null;
      return tx.warehouse.update({
        where: { id },
        data: { ...data, ...(layout ? { capacity: layoutCapacity(layout), capacityCbm: layoutVolumeCbm(layout) } : {}) },
        include: { locations: { where: { isActive: true, type: LocationType.STANDARD } }, manager: { select: MANAGER_SELECT } },
      });
    }, { timeout: 30000 });
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

// Usado por users.service.ts::updateUser para bloquear la desactivación de un
// responsable de bodega ACTIVA (Warehouse.isActive, no sus Location — una
// Cuarentena activa no cambia esta cuenta, sigue la bodega padre).
export async function countActiveWarehousesManagedBy(userId: string): Promise<number> {
  return prisma.warehouse.count({ where: { managerId: userId, isActive: true } });
}
