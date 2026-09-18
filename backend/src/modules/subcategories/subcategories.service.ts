import { prisma } from "../../lib/prisma";
import { conflict, notFound } from "../../utils/httpError";

async function assertCategoryExists(categoryId: string) {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, deletedAt: null },
  });
  if (!category) throw notFound("Categoría no encontrada");
  return category;
}

async function getSubcategoryOrThrow(id: string) {
  const subcategory = await prisma.subcategory.findFirst({ where: { id, deletedAt: null } });
  if (!subcategory) throw notFound("Subcategoría no encontrada");
  return subcategory;
}

export async function listSubcategoriesByCategory(categoryId: string) {
  await assertCategoryExists(categoryId);
  return prisma.subcategory.findMany({
    where: { categoryId, deletedAt: null },
    orderBy: { name: "asc" },
  });
}

export async function createSubcategory(categoryId: string, data: { name: string }) {
  await assertCategoryExists(categoryId);
  return prisma.subcategory.create({ data: { ...data, categoryId } });
}

export async function updateSubcategory(id: string, data: { name?: string }) {
  await getSubcategoryOrThrow(id);
  return prisma.subcategory.update({ where: { id }, data });
}

// Igual que con las categorías: no se puede eliminar si tiene productos
// activos asignados. El usuario debe reasignarlos primero.
export async function softDeleteSubcategory(id: string) {
  const subcategory = await getSubcategoryOrThrow(id);

  const productCount = await prisma.product.count({
    where: { subcategoryId: id, deletedAt: null },
  });
  if (productCount > 0) {
    throw conflict(
      `No se puede eliminar: hay ${productCount} producto(s) asignados a esta subcategoría. Reasígnalos primero.`
    );
  }

  return prisma.subcategory.update({
    where: { id: subcategory.id },
    data: { deletedAt: new Date() },
  });
}
