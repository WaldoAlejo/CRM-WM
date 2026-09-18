import { deleteFileSafely } from "../../lib/upload";
import { prisma } from "../../lib/prisma";
import { notFound } from "../../utils/httpError";

export async function addProductImage(productId: string, url: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
  if (!product) throw notFound("Producto no encontrado");

  const maxPosition = await prisma.productImage.aggregate({
    where: { productId },
    _max: { position: true },
  });

  return prisma.productImage.create({
    data: { productId, url, position: (maxPosition._max.position ?? -1) + 1 },
  });
}

export async function addVariantImage(variantId: string, url: string) {
  const variant = await prisma.productVariant.findFirst({ where: { id: variantId, deletedAt: null } });
  if (!variant) throw notFound("Variante no encontrada");

  const maxPosition = await prisma.variantImage.aggregate({
    where: { variantId },
    _max: { position: true },
  });

  return prisma.variantImage.create({
    data: { variantId, url, position: (maxPosition._max.position ?? -1) + 1 },
  });
}

// Después de borrar una imagen, deja las posiciones de las restantes
// contiguas desde 0 (evita huecos como 0, 2, 3 tras borrar la del medio).
// Son dos funciones separadas (no una genérica por nombre de modelo) a
// propósito: es un poco más de código, pero se lee directo, sin indexar
// modelos de Prisma dinámicamente.
async function reorderProductImages(productId: string) {
  const remaining = await prisma.productImage.findMany({
    where: { productId },
    orderBy: { position: "asc" },
  });
  await prisma.$transaction(
    remaining.map((img, index) =>
      prisma.productImage.update({ where: { id: img.id }, data: { position: index } })
    )
  );
}

async function reorderVariantImages(variantId: string) {
  const remaining = await prisma.variantImage.findMany({
    where: { variantId },
    orderBy: { position: "asc" },
  });
  await prisma.$transaction(
    remaining.map((img, index) =>
      prisma.variantImage.update({ where: { id: img.id }, data: { position: index } })
    )
  );
}

// DELETE /images/:id no sabe de antemano si el id es de una imagen de
// producto o de variante (son dos tablas distintas), así que se busca en
// ambas por turno.
export async function deleteImage(id: string) {
  const productImage = await prisma.productImage.findUnique({ where: { id } });
  if (productImage) {
    await prisma.productImage.delete({ where: { id } });
    deleteFileSafely(productImage.url);
    await reorderProductImages(productImage.productId);
    return;
  }

  const variantImage = await prisma.variantImage.findUnique({ where: { id } });
  if (variantImage) {
    await prisma.variantImage.delete({ where: { id } });
    deleteFileSafely(variantImage.url);
    await reorderVariantImages(variantImage.variantId);
    return;
  }

  throw notFound("Imagen no encontrada");
}
