// Solicitud de reposición al proveedor de China.
//
// DATO SENSIBLE: nada de este módulo debe exponer costo ni precio, sin
// importar el rol que consulte. Por eso las queries de acá usan un `select`
// EXPLÍCITO y cerrado (nunca `include`, que traería todas las columnas de la
// variante — incluidos costPriceCNY / wholesalePrice / retailPrice): los campos
// de costo no salen de la base de datos, no solo "se ocultan" después.
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest } from "../../utils/httpError";

// Criterio de "stock bajo" de la reposición: stock físico < 10.
export const CHINA_REQUEST_LOW_STOCK_THRESHOLD = 10;
const MAX_ROWS = 500;

const FIRST_IMAGE = { select: { url: true }, orderBy: { position: "asc" }, take: 1 } as const;

const LINE_SELECT = {
  id: true,
  label: true,
  stock: true,
  images: FIRST_IMAGE,
  product: { select: { name: true, description: true, images: FIRST_IMAGE } },
} satisfies Prisma.ProductVariantSelect;

type LineRow = Prisma.ProductVariantGetPayload<{ select: typeof LINE_SELECT }>;

export interface ChinaRequestLine {
  variantId: string;
  productName: string;
  variantLabel: string | null;
  description: string | null;
  imageUrl: string | null;
  stock: number;
}

function toLine(v: LineRow): ChinaRequestLine {
  return {
    variantId: v.id,
    productName: v.product.name,
    variantLabel: v.label,
    description: v.product.description,
    // Foto de la variante si tiene; si no, la portada del producto.
    imageUrl: v.images[0]?.url ?? v.product.images[0]?.url ?? null,
    stock: v.stock,
  };
}

// Solo variantes vigentes de productos ACTIVE: no se repone lo descontinuado.
export async function listLowStock(threshold: number) {
  const where: Prisma.ProductVariantWhereInput = {
    deletedAt: null,
    isActive: true,
    stock: { lt: threshold },
    product: { deletedAt: null, status: "ACTIVE" },
  };

  const [rows, total] = await Promise.all([
    prisma.productVariant.findMany({
      where,
      orderBy: [{ stock: "asc" }, { sku: "asc" }],
      take: MAX_ROWS,
      select: LINE_SELECT,
    }),
    prisma.productVariant.count({ where }),
  ]);

  return { threshold, total, data: rows.map(toLine) };
}

export interface SelectedItem {
  variantId: string;
  quantity: number;
}

// Valida la selección del CEO y la resuelve a las líneas del documento.
export async function resolveSelection(items: SelectedItem[]) {
  const ids = items.map((i) => i.variantId);
  const duplicated = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicated) {
    throw badRequest("Hay productos repetidos en la selección: combina las cantidades en una sola línea.", {
      field: "items",
    });
  }

  const rows = await prisma.productVariant.findMany({
    where: { id: { in: ids }, deletedAt: null, product: { deletedAt: null } },
    select: LINE_SELECT,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw badRequest(`Productos no encontrados: ${missing.join(", ")}`, { field: "items" });
  }

  // Se conserva el orden en que el CEO armó la selección.
  return items.map((item) => ({ ...toLine(byId.get(item.variantId)!), quantity: item.quantity }));
}
