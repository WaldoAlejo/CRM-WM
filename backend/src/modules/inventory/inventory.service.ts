import { MovementType, Prisma, Role } from "@prisma/client";
import { applyMovement } from "../../lib/inventoryMovements";
import { prisma } from "../../lib/prisma";
import { notFound } from "../../utils/httpError";
import { serializeMovementForRole } from "./inventory.movementSerializer";

interface CreateAdjustmentInput {
  variantId: string;
  quantity: number;
  reason: string;
  notes?: string;
}

export async function createAdjustment(
  data: CreateAdjustmentInput,
  userId: string | undefined,
  role: Role
) {
  const variant = await prisma.productVariant.findFirst({
    where: { id: data.variantId, deletedAt: null },
  });
  if (!variant) throw notFound("Variante no encontrada");

  const movement = await prisma.$transaction((tx) =>
    applyMovement(tx, {
      variantId: data.variantId,
      type: MovementType.AJUSTE,
      quantity: data.quantity,
      reason: data.reason,
      notes: data.notes,
      createdById: userId,
    })
  );

  return serializeMovementForRole(movement, role);
}

interface ListMovementsParams {
  page: number;
  pageSize: number;
  variantId?: string;
  type?: MovementType;
  importBatchId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export async function listMovements(params: ListMovementsParams, role: Role) {
  const { page, pageSize, variantId, type, importBatchId, dateFrom, dateTo } = params;

  const where: Prisma.InventoryMovementWhereInput = {
    ...(variantId && { variantId }),
    ...(type && { type }),
    ...(importBatchId && { importBatchId }),
    ...((dateFrom || dateTo) && {
      createdAt: {
        ...(dateFrom && { gte: dateFrom }),
        ...(dateTo && { lte: dateTo }),
      },
    }),
  };

  const [rows, total] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { variant: { select: { sku: true, label: true, productId: true } } },
    }),
    prisma.inventoryMovement.count({ where }),
  ]);

  return {
    data: rows.map((m) => serializeMovementForRole(m, role)),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

interface StockSummaryParams {
  page: number;
  pageSize: number;
  categoryId?: string;
  subcategoryId?: string;
  belowMinStock?: boolean;
}

interface StockSummaryVariantRow {
  id: string;
  sku: string;
  label: string | null;
  stock: number;
  reservedStock: number;
  minStock: number | null;
  warehouseLocation: string | null;
  product: { id: string; sku: string; name: string };
}

function toStockSummaryRow(v: StockSummaryVariantRow) {
  return {
    variantId: v.id,
    sku: v.sku,
    label: v.label,
    product: v.product,
    stock: v.stock,
    reservedStock: v.reservedStock,
    availableStock: v.stock - v.reservedStock,
    minStock: v.minStock,
    warehouseLocation: v.warehouseLocation,
    belowMinStock: v.minStock !== null && v.stock < v.minStock,
  };
}

const STOCK_SUMMARY_SELECT = {
  id: true,
  sku: true,
  label: true,
  stock: true,
  reservedStock: true,
  minStock: true,
  warehouseLocation: true,
  product: { select: { id: true, sku: true, name: true } },
} satisfies Prisma.ProductVariantSelect;

export async function getStockSummary(params: StockSummaryParams) {
  const { page, pageSize, categoryId, subcategoryId, belowMinStock } = params;

  const where: Prisma.ProductVariantWhereInput = {
    deletedAt: null,
    product: {
      deletedAt: null,
      ...(categoryId && { categoryId }),
      ...(subcategoryId && { subcategoryId }),
    },
  };

  // Prisma no puede expresar "stock < minStock" (comparar dos columnas de la
  // MISMA fila) en un `where` sin SQL crudo. Cuando se pide ese filtro, se
  // trae todo el conjunto que cumple el resto de filtros SIN paginar en la
  // base, se filtra en memoria, y recién ahí se pagina "a mano" — si se
  // paginara primero y se filtrara después, una página podría salir
  // incompleta o vacía aunque existan más filas que sí cumplen más adelante.
  // Con el catálogo actual (decenas de SKUs) esto es intrascendente; si
  // creciera mucho, se resolvería con un $queryRaw dedicado.
  if (belowMinStock) {
    const all = await prisma.productVariant.findMany({
      where,
      orderBy: { sku: "asc" },
      select: STOCK_SUMMARY_SELECT,
    });
    const filtered = all.map(toStockSummaryRow).filter((row) => row.belowMinStock);
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    return {
      data: filtered.slice(start, start + pageSize),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  const [variants, total] = await Promise.all([
    prisma.productVariant.findMany({
      where,
      orderBy: { sku: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: STOCK_SUMMARY_SELECT,
    }),
    prisma.productVariant.count({ where }),
  ]);

  return {
    data: variants.map(toStockSummaryRow),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}
