import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

interface SearchParams {
  q: string;
  page: number;
  pageSize: number;
}

// Búsqueda pensada para el flujo real de bodega: "cliente compra → buscar →
// despachar". Por eso devuelve VARIANTES (la unidad real de inventario, la
// que tiene stock y ubicación), no productos — nadie despacha un "producto",
// despacha un SKU concreto.
//
// El `select` explícito nunca trae los campos de precio/costo de la
// variante: no hace falta aplicar serializeVariantForRole aquí porque la
// query ni siquiera los pide a la base de datos.
export async function searchVariants({ q, page, pageSize }: SearchParams) {
  const where: Prisma.ProductVariantWhereInput = {
    deletedAt: null,
    product: { deletedAt: null },
    OR: [
      { sku: { contains: q, mode: "insensitive" } },
      { barcode: { contains: q, mode: "insensitive" } },
      { product: { name: { contains: q, mode: "insensitive" } } },
      { product: { sku: { contains: q, mode: "insensitive" } } },
      { product: { model: { contains: q, mode: "insensitive" } } },
      { product: { barcode: { contains: q, mode: "insensitive" } } },
    ],
  };

  const [variants, total] = await Promise.all([
    prisma.productVariant.findMany({
      where,
      orderBy: { sku: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        sku: true,
        barcode: true,
        label: true,
        stock: true,
        reservedStock: true,
        warehouseLocation: true,
        product: { select: { id: true, sku: true, name: true, model: true, status: true } },
      },
    }),
    prisma.productVariant.count({ where }),
  ]);

  return {
    data: variants.map((v) => ({
      variantId: v.id,
      sku: v.sku,
      barcode: v.barcode,
      label: v.label,
      stock: v.stock,
      availableStock: v.stock - v.reservedStock,
      warehouseLocation: v.warehouseLocation,
      product: v.product,
    })),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}
