import { prisma } from "../../lib/prisma";
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

export async function createCategory(data: { name: string; description?: string }) {
  return prisma.category.create({ data });
}

export async function updateCategory(
  id: string,
  data: { name?: string; description?: string }
) {
  await getCategoryById(id); // valida que exista y no esté eliminada
  return prisma.category.update({ where: { id }, data });
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
