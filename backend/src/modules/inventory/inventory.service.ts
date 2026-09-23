import { LocationType, MovementType, Prisma, Role } from "@prisma/client";
import { applyMovement } from "../../lib/inventoryMovements";
import { prisma } from "../../lib/prisma";
import { notFound } from "../../utils/httpError";
import { serializeMovementForRole } from "./inventory.movementSerializer";
import { storageEstimate } from '../../lib/storageVolume';
import { locationStorageSpace, type LegacyLayout, type SpatialLayout } from '../warehouses/warehouseSpatialCore';

interface CreateAdjustmentInput {
  variantId: string;
  quantity: number;
  reason: string;
  notes?: string;
  locationId?: string;
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

  if (data.locationId) {
    const location = await prisma.location.findFirst({
      where: { id: data.locationId, isActive: true, type: LocationType.STANDARD },
    });
    if (!location) throw notFound("Ubicación no encontrada");
  }

  const movement = await prisma.$transaction((tx) =>
    applyMovement(tx, {
      variantId: data.variantId,
      type: MovementType.AJUSTE,
      quantity: data.quantity,
      reason: data.reason,
      notes: data.notes,
      locationId: data.locationId,
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

interface StockByLocationParams {
  page: number;
  pageSize: number;
  warehouseId?: string;
  locationId?: string;
  variantId?: string;
}

// Agrega el ledger por (ubicación, variante) — mismo patrón que
// getStockSummary: sin contador paralelo, se suma `quantity` directo de
// InventoryMovement. Un movimiento nunca llena fromLocationId Y toLocationId
// a la vez (ver applyMovement), así que sumar por separado los grupos "esta
// ubicación fue destino" y "esta ubicación fue origen" y combinarlos da el
// stock neto correcto sin doble conteo.
export async function getStockByLocation(params: StockByLocationParams) {
  const { page, pageSize, warehouseId, locationId, variantId } = params;

  let locationIds: string[] | undefined;
  if (warehouseId) {
    const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId } });
    if (!warehouse) throw notFound("Bodega no encontrada");
    const locations = await prisma.location.findMany({
      where: { warehouseId },
      select: { id: true },
    });
    locationIds = locations.map((l) => l.id);
  }
  if (locationId) {
    locationIds = locationIds ? locationIds.filter((id) => id === locationId) : [locationId];
  }

  const locationFilter = locationIds ? { in: locationIds } : { not: null };
  const variantWhere = variantId ? { variantId } : {};

  const [toSums, fromSums] = await Promise.all([
    prisma.inventoryMovement.groupBy({
      by: ["toLocationId", "variantId"],
      where: { toLocationId: locationFilter, ...variantWhere },
      _sum: { quantity: true },
    }),
    prisma.inventoryMovement.groupBy({
      by: ["fromLocationId", "variantId"],
      where: { fromLocationId: locationFilter, ...variantWhere },
      _sum: { quantity: true },
    }),
  ]);

  const netByKey = new Map<string, number>();
  for (const row of toSums) {
    if (!row.toLocationId) continue;
    const key = `${row.toLocationId}|${row.variantId}`;
    netByKey.set(key, (netByKey.get(key) ?? 0) + (row._sum.quantity ?? 0));
  }
  for (const row of fromSums) {
    if (!row.fromLocationId) continue;
    const key = `${row.fromLocationId}|${row.variantId}`;
    netByKey.set(key, (netByKey.get(key) ?? 0) + (row._sum.quantity ?? 0));
  }

  const entries = Array.from(netByKey.entries())
    .map(([key, netStock]) => {
      const [locId, varId] = key.split("|");
      return { locationId: locId, variantId: varId, netStock };
    })
    .sort((a, b) => a.locationId.localeCompare(b.locationId) || a.variantId.localeCompare(b.variantId));

  const total = entries.length;
  const start = (page - 1) * pageSize;
  const pageEntries = entries.slice(start, start + pageSize);

  const locIds = [...new Set(pageEntries.map((e) => e.locationId))];
  const varIds = [...new Set(pageEntries.map((e) => e.variantId))];

  const [locations, variants] = await Promise.all([
    prisma.location.findMany({
      where: { id: { in: locIds } },
      include: { warehouse: { select: { id: true, name: true, layout: true } } },
    }),
    prisma.productVariant.findMany({
      where: { id: { in: varIds } },
      select: { id: true, sku: true, label: true, dimensionsCm: true, maxStackUnits: true, product: { select: { id: true, sku: true, name: true } } },
    }),
  ]);
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const data = pageEntries.map((e) => {
    const location = locationById.get(e.locationId);
    const variant = variantById.get(e.variantId);
    const space = location?.warehouse.layout ? locationStorageSpace(location.warehouse.layout as unknown as LegacyLayout | SpatialLayout, location.code) : null;
    const estimate = storageEstimate(variant?.dimensionsCm, e.netStock, variant?.maxStackUnits ?? 1, space?.heightM);
    return {
      locationId: e.locationId,
      locationCode: location?.code ?? null,
      warehouseId: location?.warehouseId ?? null,
      warehouseName: location?.warehouse.name ?? null,
      variantId: e.variantId,
      sku: variant?.sku ?? null,
      label: variant?.label ?? null,
      product: variant?.product ?? null,
      netStock: e.netStock,
      volumeCbm: estimate?.totalCbm ?? null,
      estimatedFloorAreaM2: estimate?.floorAreaM2 ?? null,
      stackLayers: estimate?.layers ?? null,
    };
  });

  return {
    data,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}
