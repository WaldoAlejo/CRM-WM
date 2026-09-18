import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { conflict, notFound } from "../../utils/httpError";

// El único índice único de esta tabla es parcial (WHERE "deletedAt" IS
// NULL, ver migración 20260917043052) — un P2002 acá solo puede ser por `name`.
function mapUniqueConstraintError(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw conflict("Ya existe una marca con ese nombre", { field: "name" });
  }
  throw err;
}

interface ListBrandsParams {
  page: number;
  pageSize: number;
}

export async function listBrands(params: ListBrandsParams) {
  const { page, pageSize } = params;
  const where: Prisma.BrandWhereInput = { deletedAt: null };

  const [rows, total] = await Promise.all([
    prisma.brand.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.brand.count({ where }),
  ]);

  return {
    data: rows,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function getBrandById(id: string) {
  const brand = await prisma.brand.findFirst({ where: { id, deletedAt: null } });
  if (!brand) throw notFound("Marca no encontrada");
  return brand;
}

interface BrandInput {
  name?: string;
  description?: string;
}

export async function createBrand(data: BrandInput) {
  try {
    return await prisma.brand.create({ data: { name: data.name!, description: data.description } });
  } catch (err) {
    mapUniqueConstraintError(err);
  }
}

export async function updateBrand(id: string, data: BrandInput) {
  await getBrandById(id); // valida que exista y no esté eliminada

  try {
    return await prisma.brand.update({ where: { id }, data });
  } catch (err) {
    mapUniqueConstraintError(err);
  }
}

// Mismo criterio que Category: no se puede eliminar (soft delete) una marca
// con productos activos colgando de ella — hay que reasignarlos primero.
export async function softDeleteBrand(id: string) {
  const brand = await getBrandById(id);

  const productCount = await prisma.product.count({ where: { brandId: id, deletedAt: null } });
  if (productCount > 0) {
    throw conflict(
      `No se puede eliminar la marca: tiene productos activos asociados (${productCount}). Reasígnalos primero.`
    );
  }

  return prisma.brand.update({ where: { id: brand.id }, data: { deletedAt: new Date() } });
}
