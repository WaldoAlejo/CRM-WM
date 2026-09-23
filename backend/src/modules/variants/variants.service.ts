import { Prisma, ProductStatus, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { buildLabel, generateUniqueVariantSku } from "../../lib/sku";
import { badRequest, conflict, notFound } from "../../utils/httpError";
import { serializeVariantForRole } from "./variants.serializer";

// P2002 (unique constraint) puede ser por `sku` o por `barcode`: se traduce
// a un mensaje específico con el campo exacto, nunca un "ya existe" genérico.
function mapUniqueConstraintError(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = (err.meta?.target as string[]) ?? [];
    if (target.includes("sku")) {
      throw conflict("Ya existe una variante con ese SKU", { field: "sku" });
    }
    if (target.includes("barcode")) {
      throw conflict("Ya existe una variante con ese código de barras", { field: "barcode" });
    }
  }
  throw err;
}

interface CreateVariantInput {
  attributes: Record<string, string>;
  sku?: string;
  barcode?: string;
  warehouseLocation?: string;
  minStock?: number;
  weightKg?: number;
  maxStackUnits?: number;
  dimensionsCm?: string;
  costPriceUSD?: number;
  wholesalePrice?: number;
  wholesaleDiscountPct?: number;
  retailPrice?: number;
  retailDiscountPct?: number;
  force?: boolean;
}

export async function createVariant(productId: string, data: CreateVariantInput, role: Role) {
  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
  if (!product) throw notFound("Producto no encontrado");

  if (product.status === ProductStatus.DISCONTINUED && !data.force) {
    throw badRequest(
      "El producto está descontinuado. Usa force=true para crear variantes igual (ej: al reactivarlo)."
    );
  }

  const { force, sku, attributes, ...rest } = data;
  // Si el usuario no especificó un sku, se autogenera y se auto-resuelve
  // cualquier colisión (-2, -3, ...). Si SÍ lo especificó, se valida su
  // unicidad tal cual (ver mapUniqueConstraintError) sin inventarle sufijos.
  const finalSku = sku ?? (await generateUniqueVariantSku(product.sku, attributes));
  const label = buildLabel(attributes);

  try {
    const variant = await prisma.productVariant.create({
      data: { productId, attributes, label, sku: finalSku, ...rest },
    });
    return serializeVariantForRole(variant, role);
  } catch (err) {
    mapUniqueConstraintError(err);
  }
}

interface UpdateVariantInput {
  attributes?: Record<string, string>;
  sku?: string;
  barcode?: string | null;
  warehouseLocation?: string | null;
  minStock?: number | null;
  weightKg?: number | null;
  maxStackUnits?: number;
  dimensionsCm?: string | null;
  costPriceUSD?: number | null;
  wholesalePrice?: number | null;
  wholesaleDiscountPct?: number | null;
  retailPrice?: number | null;
  retailDiscountPct?: number | null;
  isActive?: boolean;
}

export async function updateVariant(id: string, data: UpdateVariantInput, role: Role) {
  const variant = await prisma.productVariant.findFirst({ where: { id, deletedAt: null } });
  if (!variant) throw notFound("Variante no encontrada");

  // `attributes` reemplaza el objeto completo (no hace merge parcial) y
  // siempre regenera `label`; `label` nunca es un input directo de la API.
  const updateData: Prisma.ProductVariantUpdateInput = { ...data };
  if (data.attributes) {
    updateData.label = buildLabel(data.attributes);
  }

  try {
    const updated = await prisma.productVariant.update({ where: { id }, data: updateData });
    return serializeVariantForRole(updated, role);
  } catch (err) {
    mapUniqueConstraintError(err);
  }
}

export async function softDeleteVariant(id: string) {
  const variant = await prisma.productVariant.findFirst({ where: { id, deletedAt: null } });
  if (!variant) throw notFound("Variante no encontrada");

  if (variant.stock > 0 || variant.reservedStock > 0) {
    const detalleReserva = variant.reservedStock > 0 ? ` (${variant.reservedStock} reservada(s))` : "";
    throw conflict(
      `No se puede eliminar: esta variante tiene ${variant.stock} unidad(es) en stock${detalleReserva}. Ajusta el stock a 0 primero.`
    );
  }

  return prisma.productVariant.update({ where: { id }, data: { deletedAt: new Date() } });
}
