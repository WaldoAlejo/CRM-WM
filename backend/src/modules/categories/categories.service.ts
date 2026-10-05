import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { suggestCategoryCode } from "../../lib/sku";
import { conflict, notFound } from "../../utils/httpError";

export async function listCategories() {
  return prisma.category.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    include: {
      subcategories: { where: { deletedAt: null }, orderBy: { name: "asc" } },
      _count: { select: { products: { where: { deletedAt: null } } } },
    },
  });
}

export async function getCategoryById(id: string) {
  const category = await prisma.category.findFirst({
    where: { id, deletedAt: null },
    include: {
      subcategories: { where: { deletedAt: null }, orderBy: { name: "asc" } },
    },
  });
  if (!category) throw notFound("Categoría no encontrada");
  return category;
}

// El código es el prefijo de los SKU (COC-0001) y es único entre TODAS las
// categorías, incluidas las eliminadas: sus productos conservan ese prefijo.
function mapCodeConflict(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && String(err.meta?.target).includes("code")) {
    throw conflict("Ese código ya lo usa otra categoría", { field: "code" });
  }
  throw err;
}

export async function createCategory(data: { name: string; description?: string; code?: string }) {
  const taken = new Set((await prisma.category.findMany({ select: { code: true } })).map((c) => c.code));
  const code = data.code || suggestCategoryCode(data.name, taken);
  return prisma.category.create({ data: { ...data, code } }).catch(mapCodeConflict);
}

// Cambiar el código solo afecta a productos nuevos: los SKU ya asignados no cambian.
export async function updateCategory(
  id: string,
  data: { name?: string; description?: string; code?: string }
) {
  await getCategoryById(id); // valida que exista y no esté eliminada
  return prisma.category.update({ where: { id }, data }).catch(mapCodeConflict);
}

// Antes de borrar (soft delete), hay que asegurarse de que no queden
// productos ni subcategorías activas colgando de esta categoría: si las hay,
// el usuario debe reasignarlas/borrarlas primero (requisito explícito del negocio).
export async function softDeleteCategory(id: string) {
  const category = await getCategoryById(id);

  const [productCount, subcategoryCount] = await Promise.all([
    prisma.product.count({ where: { categoryId: id, deletedAt: null } }),
    prisma.subcategory.count({ where: { categoryId: id, deletedAt: null } }),
  ]);

  if (productCount > 0) {
    throw conflict(
      `No se puede eliminar: hay ${productCount} producto(s) asignados a esta categoría. Reasígnalos primero.`
    );
  }
  if (subcategoryCount > 0) {
    throw conflict(
      `No se puede eliminar: hay ${subcategoryCount} subcategoría(s) activas dentro de esta categoría. Elimínalas o reasígnalas primero.`
    );
  }

  return prisma.category.update({
    where: { id: category.id },
    data: { deletedAt: new Date() },
  });
}
