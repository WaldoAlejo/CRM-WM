import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { conflict, notFound } from "../../utils/httpError";

// `Courier.name` sigue siendo un @unique normal (no parcial): a diferencia
// de Supplier/Brand/FinalCustomer, este modelo no tiene `deletedAt` — usa
// `isActive` (ya existía en el schema) como su equivalente de soft delete.
function mapUniqueConstraintError(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw conflict("Ya existe un courier con ese nombre", { field: "name" });
  }
  throw err;
}

interface ListCouriersParams {
  page: number;
  pageSize: number;
}

export async function listCouriers(params: ListCouriersParams) {
  const { page, pageSize } = params;
  const where: Prisma.CourierWhereInput = { isActive: true };

  const [rows, total] = await Promise.all([
    prisma.courier.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.courier.count({ where }),
  ]);

  return {
    data: rows,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function getCourierById(id: string) {
  const courier = await prisma.courier.findFirst({ where: { id, isActive: true } });
  if (!courier) throw notFound("Courier no encontrado");
  return courier;
}

interface CourierInput {
  name?: string;
  contactInfo?: string;
}

export async function createCourier(data: CourierInput) {
  try {
    return await prisma.courier.create({ data: { name: data.name!, contactInfo: data.contactInfo } });
  } catch (err) {
    mapUniqueConstraintError(err);
  }
}

export async function updateCourier(id: string, data: CourierInput) {
  await getCourierById(id); // valida que exista y esté activo

  try {
    return await prisma.courier.update({ where: { id }, data });
  } catch (err) {
    mapUniqueConstraintError(err);
  }
}

// "Soft delete" de este modelo = isActive:false (no hay deletedAt en
// Courier). Sin bloqueo por Shipment dependientes: son historial inmutable,
// igual que ImportBatch para Supplier.
export async function deactivateCourier(id: string) {
  const courier = await getCourierById(id);
  return prisma.courier.update({ where: { id: courier.id }, data: { isActive: false } });
}
