import { LocationType, MovementType, Prisma, Role } from "@prisma/client";
import { applyMovement } from "../../lib/inventoryMovements";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, notFound, unprocessableEntity } from "../../utils/httpError";
import { serializeMovementForRole } from "../inventory/inventory.movementSerializer";
import { serializeImportBatchForRole } from "./importBatches.serializer";
import { computeReceiveRequestHash } from "./receiveRequestHash";
import type { CartonPackaging } from '../../lib/cartonPackaging';

interface CreateImportBatchInput {
  containerType: "20" | "40" | "40HC" | "LCL";
  containerCbm: number;
  reference: string;
  supplierId?: string;
  arrivalDate: Date;
  notes?: string;
  freightCost?: number;
  customsCost?: number;
  otherCosts?: number;
}

export async function createImportBatch(
  data: CreateImportBatchInput,
  userId: string | undefined,
  role: Role
) {
  if (data.supplierId) {
    const supplier = await prisma.supplier.findFirst({
      where: { id: data.supplierId, deletedAt: null },
    });
    if (!supplier) throw notFound("Proveedor no encontrado");
  }

  try {
    const batch = await prisma.importBatch.create({ data: { ...data, createdById: userId } });
    return serializeImportBatchForRole(batch, role);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw conflict("Ya existe un lote de importación con esa referencia", { field: "reference" });
    }
    throw err;
  }
}

interface ListImportBatchesParams {
  page: number;
  pageSize: number;
  supplierId?: string;
}

export async function listImportBatches(params: ListImportBatchesParams, role: Role) {
  const { page, pageSize, supplierId } = params;
  const where: Prisma.ImportBatchWhereInput = { ...(supplierId && { supplierId }) };

  const [rows, total] = await Promise.all([
    prisma.importBatch.findMany({
      where,
      orderBy: { arrivalDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        supplier: { select: { id: true, name: true } },
        _count: { select: { movements: true } },
      },
    }),
    prisma.importBatch.count({ where }),
  ]);

  return {
    data: rows.map(({ _count, ...batch }) =>
      serializeImportBatchForRole({ ...batch, movementsCount: _count.movements }, role)
    ),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function getImportBatchById(id: string, role: Role) {
  const batch = await prisma.importBatch.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true } },
      movements: {
        where: { type: MovementType.INGRESO },
        orderBy: { createdAt: "asc" },
        // productId: no es dato de costo/precio (igual que en inventory.service.ts::listMovements,
        // que ya lo expone a todos los roles) — lo usa la calculadora de precios del
        // frontend para enlazar "Usar este PVP" con la página del producto.
        include: { variant: { select: { sku: true, label: true, productId: true, dimensionsCm: true, maxStackUnits: true } } },
      },
    },
  });
  if (!batch) throw notFound("Lote de importación no encontrado");

  return serializeImportBatchForRole(
    { ...batch, movements: batch.movements.map((m) => serializeMovementForRole(m, role)) },
    role
  );
}

interface ReceiveLine {
  packaging?: CartonPackaging;
  variantId: string;
  quantity: number;
  unitCost: number;
  volumeCbm: number;
  notes?: string;
  locationId: string;
}

interface ReceiveStockResponse {
  importBatchId: string;
  movements: Record<string, unknown>[];
}

export async function receiveStock(
  importBatchId: string,
  lines: ReceiveLine[],
  userId: string | undefined,
  role: Role,
  idempotencyKey: string | undefined
): Promise<ReceiveStockResponse> {
  const batch = await prisma.importBatch.findUnique({ where: { id: importBatchId } });
  if (!batch) throw notFound("Lote de importación no encontrado");

  const requestHash = computeReceiveRequestHash(lines);

  if (idempotencyKey) {
    const existing = await prisma.idempotencyKey.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.importBatchId !== importBatchId) {
        throw conflict("Esta Idempotency-Key ya se usó para otro lote de importación.");
      }
      if (existing.requestHash !== requestHash) {
        throw unprocessableEntity("Esta Idempotency-Key ya se usó con datos distintos", {
          field: "Idempotency-Key",
        });
      }
      const cached = existing.response as unknown as ReceiveStockResponse;
      return {
        importBatchId: cached.importBatchId,
        movements: cached.movements.map((m) => serializeMovementForRole(m, role)),
      };
    }
  }

  // Pre-validación ANTES de abrir la transacción: da un error claro con los
  // ids exactos que faltan, en vez de que la transacción explote a mitad de
  // camino con un P2025 genérico en una línea cualquiera.
  const variantIds = [...new Set(lines.map((l) => l.variantId))];
  const foundVariants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, deletedAt: null },
    select: { id: true },
  });
  const foundIds = new Set(foundVariants.map((v) => v.id));
  const missingIds = variantIds.filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) {
    throw badRequest(`Variantes no encontradas: ${missingIds.join(", ")}`, { field: "lines" });
  }

  const locationIds = [...new Set(lines.map((l) => l.locationId).filter((id): id is string => !!id))];
  if (locationIds.length > 0) {
    const foundLocations = await prisma.location.findMany({
      where: { id: { in: locationIds }, isActive: true, type: LocationType.STANDARD, warehouse: { isActive: true } },
      select: { id: true },
    });
    const foundLocationIds = new Set(foundLocations.map((l) => l.id));
    const missingLocationIds = locationIds.filter((id) => !foundLocationIds.has(id));
    if (missingLocationIds.length > 0) {
      throw badRequest(`Ubicaciones no encontradas: ${missingLocationIds.join(", ")}`, { field: "lines" });
    }
  }

  if (!batch.containerCbm || !batch.containerType) {
    throw badRequest("Este lote histórico no tiene volumen de contenedor. Crea un lote con CBM para las nuevas recepciones.");
  }
  const totalBatchCost = new Prisma.Decimal(batch.freightCost ?? 0)
    .plus(batch.customsCost ?? 0).plus(batch.otherCosts ?? 0);
  const costPerCbm = totalBatchCost.dividedBy(batch.containerCbm);

  const result = await prisma.$transaction(async (tx) => {
    // Updating the immutable reference to itself locks the batch in Prisma's
    // configured schema, including isolated test schemas behind a pooler.
    await tx.importBatch.update({
      where: { id: importBatchId },
      data: { reference: batch.reference },
    });
    if (idempotencyKey) {
      const cached = await tx.idempotencyKey.findUnique({ where: { idempotencyKey } });
      if (cached) {
        if (cached.importBatchId !== importBatchId || cached.requestHash !== requestHash) {
          throw conflict("Idempotency-Key ya utilizada con otros datos.");
        }
        return cached.response as unknown as ReceiveStockResponse;
      }
    }
    const received = await tx.inventoryMovement.aggregate({
      where: { importBatchId, type: MovementType.INGRESO }, _sum: { volumeCbm: true },
    });
    const requestedCbm = lines.reduce((sum, line) => sum.plus(line.volumeCbm), new Prisma.Decimal(0));
    if (requestedCbm.plus(received._sum.volumeCbm ?? 0).greaterThan(batch.containerCbm!)) {
      throw badRequest("El volumen recibido supera los CBM contratados del lote", { field: "lines" });
    }
    const movements = [];
    for (const line of lines) {
      const movement = await applyMovement(tx, {
        variantId: line.variantId,
        packaging: line.packaging,
        type: MovementType.INGRESO,
        quantity: line.quantity,
        unitCost: line.unitCost,
        landedCostPerUnit: costPerCbm.times(line.volumeCbm).dividedBy(line.quantity).toNumber(),
        volumeCbm: line.volumeCbm,
        notes: line.notes,
        locationId: line.locationId,
        importBatchId,
        createdById: userId,
      });
      await tx.productVariant.update({
        where: { id: line.variantId },
        data: { costPriceUSD: movement.unitCost },
      });
      movements.push(movement);
    }

    // JSON.parse(JSON.stringify(...)) fuerza a texto plano (Decimal -> string
    // vía su propio toJSON, Date -> ISO string): es justo lo que necesita el
    // campo Json de Prisma, y además es la MISMA forma en la que Express
    // serializaría estos valores en una respuesta normal — así la respuesta
    // cacheada y una respuesta fresca quedan con exactamente el mismo shape.
    const response: ReceiveStockResponse = JSON.parse(
      JSON.stringify({ importBatchId, movements })
    );

    if (idempotencyKey) {
      await tx.idempotencyKey.create({
        data: {
          idempotencyKey,
          importBatchId,
          requestHash,
          response: response as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return response;
  });

  return {
    importBatchId: result.importBatchId,
    movements: result.movements.map((m) => serializeMovementForRole(m, role)),
  };
}
