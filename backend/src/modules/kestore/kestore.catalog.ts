import { Prisma, ProductStatus, type Product, type ProductVariant } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { parseDimensions } from "../../lib/storageVolume";

const variantInclude = {
  images: { select: { url: true }, orderBy: { position: "asc" } },
  kestoreSyncState: true,
  product: {
    include: {
      brand: { select: { name: true } },
      category: { select: { name: true } },
      subcategory: { select: { name: true } },
      images: { select: { url: true }, orderBy: { position: "asc" } },
    },
  },
} satisfies Prisma.ProductVariantInclude;

type KestoreVariant = Prisma.ProductVariantGetPayload<{ include: typeof variantInclude }>;
type StateInput = Pick<ProductVariant, "kestoreCode" | "wholesalePrice" | "isActive" | "deletedAt" | "stock" | "reservedStock">
  & { product: Pick<Product, "showOnKestore" | "status" | "deletedAt" | "ivaRate"> };

// Lo que Kestore debe mostrar de una variante. Solo se publica si tiene código
// de Kestore, precio mayorista, el producto está marcado para Kestore y nada
// está descontinuado ni borrado; si no, va inactiva y con stock 0.
export function kestoreState(variant: StateInput) {
  const { product } = variant;
  const active = !!variant.kestoreCode && variant.wholesalePrice !== null && variant.isActive && !variant.deletedAt
    && product.showOnKestore && product.status === ProductStatus.ACTIVE && !product.deletedAt;
  const priceWithoutIva = variant.wholesalePrice ?? new Prisma.Decimal(0);
  const ivaRate = product.ivaRate ?? new Prisma.Decimal(0);
  return {
    active,
    // Disponible = existencias de todas las bodegas menos lo reservado por
    // despachos pendientes (incluidos los pedidos de Kestore aún no entregados).
    stock: active ? Math.max(0, variant.stock - variant.reservedStock) : 0,
    priceWithoutIva: priceWithoutIva.toDecimalPlaces(2),
    ivaRate,
    // Los precios del CRM no incluyen IVA; Kestore publica el precio con IVA.
    price: priceWithoutIva.times(ivaRate.div(100).plus(1)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
  };
}

// Variantes que Kestore conoce o debe conocer: las que tienen código y las que
// ya se le enviaron (para avisarle cuando dejan de publicarse).
export function findKestoreVariants() {
  return prisma.productVariant.findMany({
    where: { OR: [{ kestoreCode: { not: null } }, { kestoreSyncState: { isNot: null } }] },
    include: variantInclude,
    orderBy: { kestoreCode: "asc" },
  });
}

function absoluteUrl(url: string, baseUrl: string) {
  return /^https?:\/\//.test(url) ? url : `${baseUrl.replace(/\/$/, "")}${url}`;
}

export function toCatalogItem(variant: KestoreVariant, baseUrl: string) {
  const state = kestoreState(variant);
  const dimensions = parseDimensions(variant.dimensionsCm);
  const images = [...variant.images, ...variant.product.images].map((image) => absoluteUrl(image.url, baseUrl));
  return {
    codigo: variant.kestoreCode,
    sku: variant.sku,
    nombre: variant.product.name,
    variante: variant.label,
    descripcion: variant.product.description,
    marca: variant.product.brand?.name ?? null,
    categoria: variant.product.category.name,
    subcategoria: variant.product.subcategory?.name ?? null,
    precio: state.price.toNumber(),
    precioSinIva: state.priceWithoutIva.toNumber(),
    ivaPorcentaje: state.ivaRate.toNumber(),
    stock: state.stock,
    activo: state.active,
    pesoKg: variant.weightKg?.toNumber() ?? null,
    dimensionesCm: dimensions ? { largo: dimensions[0], ancho: dimensions[1], alto: dimensions[2] } : null,
    imagenes: [...new Set(images)],
  };
}
