import { Prisma, ProductStatus, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { serializeVariantForRole } from "../variants/variants.serializer";
import { badRequest, conflict, notFound } from "../../utils/httpError";
import { hasAdminAccess } from '../../lib/roles';
import { catalogWeightedCosts } from '../../lib/weightedLandedCost';

// P2002 (unique constraint) puede ser por `sku` o por `barcode`: se traduce
// a un mensaje específico con el campo exacto, nunca un "ya existe" genérico.
function mapUniqueConstraintError(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = (err.meta?.target as string[]) ?? [];
    if (target.includes("sku")) {
      throw conflict("Ya existe un producto con ese SKU", { field: "sku" });
    }
    if (target.includes("barcode")) {
      throw conflict("Ya existe un producto con ese código de barras", { field: "barcode" });
    }
  }
  throw err;
}

async function assertSubcategoryBelongsToCategory(subcategoryId: string, categoryId: string) {
  const subcategory = await prisma.subcategory.findFirst({
    where: { id: subcategoryId, deletedAt: null },
  });
  if (!subcategory) throw notFound("Subcategoría no encontrada");
  if (subcategory.categoryId !== categoryId) {
    throw badRequest("La subcategoría no pertenece a la categoría indicada");
  }
}

async function assertBrandExists(brandId: string) {
  const brand = await prisma.brand.findFirst({ where: { id: brandId, deletedAt: null } });
  if (!brand) throw notFound("Marca no encontrada");
}

interface ListProductsParams {
  page: number;
  pageSize: number;
  categoryId?: string;
  subcategoryId?: string;
  status?: ProductStatus;
  brandId?: string;
  q?: string;
}

// Costos calculados en una consulta por página y expuestos solo a ADMIN/CEO.
export async function listProducts(params: ListProductsParams, role: Role) {
  const { page, pageSize, categoryId, subcategoryId, status, brandId, q } = params;

  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(categoryId && { categoryId }),
    ...(subcategoryId && { subcategoryId }),
    ...(status && { status }),
    ...(brandId && { brandId }),
    ...(q && {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
        { model: { contains: q, mode: "insensitive" } },
      ],
    }),
  };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        category: { select: { id: true, name: true } },
        subcategory: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        _count: { select: { variants: { where: { deletedAt: null } } } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  const costs = hasAdminAccess(role) ? await catalogWeightedCosts(prisma, rows.map(p => p.id)) : null;
  return {
    data: rows.map(({ _count, ...product }) => ({ ...product, variantCount: _count.variants,
      ...(costs && { weightedAverageCost: costs.products.get(product.id) ?? null }),
    })),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function getProductById(id: string, role: Role) {
  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null },
    include: {
      category: { select: { id: true, name: true } },
      subcategory: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } },
      images: { orderBy: { position: "asc" } },
      certifications: true,
      attachments: true,
      variants: {
        where: { deletedAt: null },
        orderBy: { sku: "asc" },
        include: { images: { orderBy: { position: "asc" } } },
      },
    },
  });
  if (!product) throw notFound("Producto no encontrado");
  const costs = hasAdminAccess(role) ? await catalogWeightedCosts(prisma, [id]) : null;
  return {
    ...product,
    ...(costs && { weightedAverageCost: costs.products.get(id) ?? null }),
    variants: product.variants.map((variant) => serializeVariantForRole({ ...variant,
      ...(costs && { weightedAverageCost: costs.variants.get(variant.id) ?? null }),
    }, role)),
  };
}

interface CreateProductInput {
  sku: string;
  name: string;
  description?: string;
  model?: string;
  barcode?: string;
  categoryId: string;
  subcategoryId?: string;
  brandId?: string;
}

export async function createProduct(data: CreateProductInput, userId?: string) {
  const category = await prisma.category.findFirst({ where: { id: data.categoryId, deletedAt: null } });
  if (!category) throw notFound("Categoría no encontrada");

  if (data.subcategoryId) {
    await assertSubcategoryBelongsToCategory(data.subcategoryId, data.categoryId);
  }

  if (data.brandId) {
    await assertBrandExists(data.brandId);
  }

  try {
    return await prisma.product.create({
      data: { ...data, createdById: userId, updatedById: userId },
    });
  } catch (err) {
    mapUniqueConstraintError(err);
  }
}

interface UpdateProductInput {
  sku?: string;
  name?: string;
  description?: string | null;
  model?: string | null;
  barcode?: string | null;
  status?: ProductStatus;
  categoryId?: string;
  subcategoryId?: string | null;
  brandId?: string | null;
}

export async function updateProduct(id: string, data: UpdateProductInput, userId?: string) {
  const product = await prisma.product.findFirst({ where: { id, deletedAt: null } });
  if (!product) throw notFound("Producto no encontrado");

  const categoryChanges = "categoryId" in data && data.categoryId !== product.categoryId;

  if (categoryChanges) {
    const newCategory = await prisma.category.findFirst({
      where: { id: data.categoryId, deletedAt: null },
    });
    if (!newCategory) throw notFound("Categoría no encontrada");

    // Si el producto ya tenía subcategoría asignada, cambiar de categoría
    // sin decir explícitamente qué pasa con ella es ambiguo: ¿se mantiene
    // (y podría quedar de una categoría distinta), se limpia sola? En vez de
    // adivinar (y arriesgarnos a limpiarla sin que el usuario lo pidiera),
    // se exige que el body confirme `subcategoryId` (aunque sea el mismo
    // valor, o null a propósito para limpiarla).
    if (product.subcategoryId !== null && !("subcategoryId" in data)) {
      throw badRequest("Debes confirmar la subcategoría al cambiar de categoría");
    }
  }

  const nextCategoryId = data.categoryId ?? product.categoryId;
  if ("subcategoryId" in data && data.subcategoryId) {
    await assertSubcategoryBelongsToCategory(data.subcategoryId, nextCategoryId);
  }

  if ("brandId" in data && data.brandId) {
    await assertBrandExists(data.brandId);
  }

  try {
    return await prisma.product.update({
      where: { id },
      data: { ...data, updatedById: userId },
    });
  } catch (err) {
    mapUniqueConstraintError(err);
  }
}

export async function softDeleteProduct(id: string) {
  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null },
    include: { variants: { where: { deletedAt: null } } },
  });
  if (!product) throw notFound("Producto no encontrado");

  const blockingVariants = product.variants.filter((v) => v.stock > 0 || v.reservedStock > 0);
  if (blockingVariants.length > 0) {
    throw conflict(
      `No se puede eliminar: hay ${blockingVariants.length} variante(s) con stock disponible o reservado. Ajusta el stock a 0 primero.`
    );
  }

  return prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });
}
