import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { conflict, notFound } from "../../utils/httpError";

// El único índice único de esta tabla es parcial (WHERE "deletedAt" IS
// NULL, ver migración 20260917043052) — no hay ambigüedad de campo que
// resolver en meta.target, un P2002 acá solo puede ser por `name`.
function mapUniqueConstraintError(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw conflict("Ya existe un proveedor con ese nombre", { field: "name" });
  }
  throw err;
}

interface ListSuppliersParams {
  page: number;
  pageSize: number;
}

export async function listSuppliers(params: ListSuppliersParams) {
  const { page, pageSize } = params;
  const where: Prisma.SupplierWhereInput = { deletedAt: null };

  const [rows, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.supplier.count({ where }),
  ]);

  return {
    data: rows,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function getSupplierById(id: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!supplier) throw notFound("Proveedor no encontrado");
  return supplier;
}

interface SupplierInput {
  name?: string;
  contactInfo?: string;
}

export async function createSupplier(data: SupplierInput) {
  try {
    return await prisma.supplier.create({ data: { name: data.name!, contactInfo: data.contactInfo } });
  } catch (err) {
    mapUniqueConstraintError(err);
  }
}

export async function updateSupplier(id: string, data: SupplierInput) {
  await getSupplierById(id); // valida que exista y no esté eliminado

  try {
    return await prisma.supplier.update({ where: { id }, data });
  } catch (err) {
    mapUniqueConstraintError(err);
  }
}

// Sin bloqueo por ImportBatch dependientes: son historial inmutable, un
// proveedor soft-deleted no les afecta (siguen mostrando su nombre tal cual
// quedó registrado). Distinto del caso de Category/Brand, donde sí importa
// que no queden productos "huérfanos" de catálogo activo.
export async function softDeleteSupplier(id: string) {
  const supplier = await getSupplierById(id);
  return prisma.supplier.update({ where: { id: supplier.id }, data: { deletedAt: new Date() } });
}
