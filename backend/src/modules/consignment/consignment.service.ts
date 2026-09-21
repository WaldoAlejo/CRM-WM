// Ventas a consignación (solo mayoristas, siempre a crédito). Ver el bloque de
// comentarios de ConsignmentLot en schema.prisma para el modelo completo.
//
// - Entrega: movimiento CONSIGNACION por línea, SIN cargo ni cuenta por cobrar.
// - Revisión cada N días (20 por defecto): EXTENDER (sin cargo, +N días desde el
//   registro) o LIQUIDAR (parcial las veces que haga falta). Liquidar genera un
//   cargo a crédito (DispatchOrder) SOLO por lo vendido, y manda lo devuelto a
//   Cuarentena (ver quarantine.service.ts).
// - "Revisión vencida" se DERIVA (nextReviewDate < ahora en un lote no cerrado);
//   nunca se fuerza liquidación ni se extiende sola.
import {
  ConsignmentStatus,
  DispatchOrderOrigin,
  DispatchStatus,
  LocationType,
  MovementType,
  PaymentMethod,
  Prisma,
  ReturnSource,
  ReviewAction,
} from "@prisma/client";
import { computeLandedCost, computeWeightedAverageCost, applyMovement } from "../../lib/inventoryMovements";
import { generateConsignmentCode, generateOrderNumber } from "../../lib/orderNumber";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, notFound } from "../../utils/httpError";
import { createReturnBatch } from "../quarantine/quarantine.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

export type ConsignmentDisplayStatus = ConsignmentStatus | "REVISION_VENCIDA";

export function computeDisplayStatus(lot: { status: ConsignmentStatus; nextReviewDate: Date }, now = new Date()) {
  const isReviewOverdue = lot.status !== ConsignmentStatus.CERRADO && lot.nextReviewDate.getTime() < now.getTime();
  const displayStatus: ConsignmentDisplayStatus = isReviewOverdue ? "REVISION_VENCIDA" : lot.status;
  return { isReviewOverdue, displayStatus };
}

// ---------------------------------------------------------------------------
// Crear lote (entrega)
// ---------------------------------------------------------------------------

export interface CreateLotInput {
  wholesalerId: string;
  shippingProvince: string;
  shippingCity: string;
  creditDays?: number;
  deliveredAt?: Date;
  reviewIntervalDays: number;
  notes?: string;
  lines: { variantId: string; quantity: number; unitPrice?: number; locationId?: string }[];
}

export async function createLot(data: CreateLotInput, userId: string | undefined) {
  const wholesaler = await prisma.wholesaler.findFirst({ where: { id: data.wholesalerId, deletedAt: null } });
  if (!wholesaler) throw notFound("Mayorista no encontrado");

  const creditDays = data.creditDays ?? wholesaler.defaultCreditDays ?? undefined;
  if (!creditDays) {
    throw badRequest("creditDays es obligatorio (la consignación siempre es a crédito y el mayorista no tiene un valor por defecto)");
  }

  const ids = data.lines.map((l) => l.variantId);
  const duplicated = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicated) {
    throw badRequest("Hay productos repetidos en el lote: combina las cantidades en una sola línea.", { field: "lines" });
  }

  const variants = await prisma.productVariant.findMany({ where: { id: { in: ids }, deletedAt: null } });
  const variantById = new Map(variants.map((v) => [v.id, v]));
  const missing = ids.filter((id) => !variantById.has(id));
  if (missing.length > 0) throw badRequest(`Variantes no encontradas: ${missing.join(", ")}`, { field: "lines" });

  const locationIds = [...new Set(data.lines.map((l) => l.locationId).filter((id): id is string => !!id))];
  if (locationIds.length > 0) {
    const found = await prisma.location.findMany({
      where: { id: { in: locationIds }, isActive: true, type: LocationType.STANDARD },
      select: { id: true },
    });
    const foundIds = new Set(found.map((l) => l.id));
    const missingLoc = locationIds.filter((id) => !foundIds.has(id));
    if (missingLoc.length > 0) throw badRequest(`Ubicaciones no encontradas: ${missingLoc.join(", ")}`, { field: "lines" });
  }

  // Precio congelado: el indicado o, si no, el mayorista de lista de la variante.
  const priced = data.lines.map((l) => {
    const unitPrice = l.unitPrice ?? (variantById.get(l.variantId)!.wholesalePrice?.toNumber() ?? undefined);
    if (unitPrice === undefined) {
      throw badRequest(`La variante ${variantById.get(l.variantId)!.sku} no tiene precio mayorista: indica unitPrice.`, { field: "lines" });
    }
    return { ...l, unitPrice };
  });
  // Orden estable de variantes: dos lotes simultáneos nunca se esperan en círculo.
  priced.sort((a, b) => a.variantId.localeCompare(b.variantId));

  const deliveredAt = data.deliveredAt ?? new Date();

  const lot = await prisma.$transaction(
    async (tx) => {
      const code = await generateConsignmentCode(tx);

      const created = await tx.consignmentLot.create({
        data: {
          code,
          wholesalerId: data.wholesalerId,
          shippingProvince: data.shippingProvince,
          shippingCity: data.shippingCity,
          deliveredAt,
          reviewIntervalDays: data.reviewIntervalDays,
          creditDays,
          nextReviewDate: addDays(deliveredAt, data.reviewIntervalDays),
          notes: data.notes,
          createdById: userId,
        },
      });

      for (const line of priced) {
        const [unitCostSnapshot, landedCostSnapshot] = await Promise.all([
          computeWeightedAverageCost(tx, line.variantId),
          computeLandedCost(tx, line.variantId),
        ]);

        const movement = await applyMovement(tx, {
          variantId: line.variantId,
          type: MovementType.CONSIGNACION,
          quantity: -line.quantity,
          locationId: line.locationId,
          notes: `Consignación ${code}`,
          createdById: userId,
        });

        // No se puede consignar lo ya comprometido por órdenes PENDIENTE.
        const variant = await tx.productVariant.findUniqueOrThrow({
          where: { id: line.variantId },
          select: { sku: true, stock: true, reservedStock: true },
        });
        if (variant.stock < variant.reservedStock) {
          throw badRequest(
            `Stock insuficiente para la variante ${variant.sku} (disponible: ${variant.stock + line.quantity - variant.reservedStock}, solicitado: ${line.quantity})`
          );
        }

        await tx.consignmentLine.create({
          data: {
            lotId: created.id,
            variantId: line.variantId,
            originLocationId: line.locationId,
            quantityDelivered: line.quantity,
            unitPrice: line.unitPrice,
            unitCostSnapshot,
            landedCostSnapshot,
            deliveryMovementId: movement.id,
          },
        });
      }

      return created;
    },
    { timeout: 20000 }
  );

  return getLot(lot.id);
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

// pendiente = entregado − Σ vendido − Σ devuelto (calculado, sin caché).
function summarizeLine(line: {
  quantityDelivered: number;
  reviewLines: { quantitySold: number; quantityReturned: number }[];
}) {
  const sold = line.reviewLines.reduce((s, r) => s + r.quantitySold, 0);
  const returned = line.reviewLines.reduce((s, r) => s + r.quantityReturned, 0);
  return { sold, returned, pending: line.quantityDelivered - sold - returned };
}

interface ListLotsParams {
  page: number;
  pageSize: number;
  status?: ConsignmentStatus;
  wholesalerId?: string;
  overdue?: boolean;
}

export async function listLots(params: ListLotsParams) {
  const { page, pageSize, status, wholesalerId, overdue } = params;
  const where: Prisma.ConsignmentLotWhereInput = {
    ...(status && { status }),
    ...(wholesalerId && { wholesalerId }),
    ...(overdue && { status: { not: ConsignmentStatus.CERRADO }, nextReviewDate: { lt: new Date() } }),
  };

  const [rows, total] = await Promise.all([
    prisma.consignmentLot.findMany({
      where,
      orderBy: [{ nextReviewDate: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        wholesaler: { select: { id: true, businessName: true } },
        lines: { select: { quantityDelivered: true, reviewLines: { select: { quantitySold: true, quantityReturned: true } } } },
      },
    }),
    prisma.consignmentLot.count({ where }),
  ]);

  const now = new Date();
  const data = rows.map(({ lines, ...lot }) => {
    const totals = lines.reduce(
      (acc, l) => {
        const s = summarizeLine(l);
        return {
          delivered: acc.delivered + l.quantityDelivered,
          sold: acc.sold + s.sold,
          returned: acc.returned + s.returned,
          pending: acc.pending + s.pending,
        };
      },
      { delivered: 0, sold: 0, returned: 0, pending: 0 }
    );
    return { ...lot, ...computeDisplayStatus(lot, now), totals };
  });

  return { data, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

export async function getLot(id: string) {
  const lot = await prisma.consignmentLot.findUnique({
    where: { id },
    include: {
      wholesaler: { select: { id: true, businessName: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          variantId: true,
          originLocationId: true,
          quantityDelivered: true,
          unitPrice: true,
          variant: { select: { sku: true, label: true, product: { select: { name: true } } } },
          reviewLines: { select: { quantitySold: true, quantityReturned: true } },
        },
      },
      reviews: {
        orderBy: { reviewedAt: "asc" },
        include: {
          lines: { select: { lineId: true, quantitySold: true, quantityReturned: true } },
          chargeOrder: { select: { id: true, orderNumber: true, dueDate: true } },
          returnBatch: { select: { id: true, completedAt: true, chargeOrder: { select: { id: true, orderNumber: true } } } },
        },
      },
    },
  });
  if (!lot) throw notFound("Lote de consignación no encontrado");

  const lines = lot.lines.map(({ reviewLines, variant, ...line }) => ({
    ...line,
    sku: variant.sku,
    label: variant.label,
    productName: variant.product.name,
    ...summarizeLine({ quantityDelivered: line.quantityDelivered, reviewLines }),
  }));

  return { ...lot, lines, ...computeDisplayStatus(lot) };
}

// Alerta para el Dashboard: lotes con la revisión vencida (sin liquidar ni extender).
export async function listOverdueReviews() {
  const now = new Date();
  const rows = await prisma.consignmentLot.findMany({
    where: { status: { not: ConsignmentStatus.CERRADO }, nextReviewDate: { lt: now } },
    orderBy: { nextReviewDate: "asc" },
    select: {
      id: true,
      code: true,
      status: true,
      nextReviewDate: true,
      wholesaler: { select: { id: true, businessName: true } },
    },
  });

  return {
    count: rows.length,
    data: rows.map((r) => ({
      ...r,
      displayStatus: "REVISION_VENCIDA" as const,
      daysOverdue: Math.max(1, Math.floor((now.getTime() - r.nextReviewDate.getTime()) / DAY_MS)),
    })),
  };
}

export async function countOverdueReviews(): Promise<number> {
  return prisma.consignmentLot.count({
    where: { status: { not: ConsignmentStatus.CERRADO }, nextReviewDate: { lt: new Date() } },
  });
}

// ---------------------------------------------------------------------------
// Revisión: extender o liquidar (parcial múltiple)
// ---------------------------------------------------------------------------

export interface CreateReviewInput {
  action: ReviewAction;
  notes?: string;
  lines: { lineId: string; quantitySold: number; quantityReturned: number }[];
}

export async function createReview(lotId: string, data: CreateReviewInput, userId: string | undefined) {
  const exists = await prisma.consignmentLot.findUnique({ where: { id: lotId }, select: { id: true } });
  if (!exists) throw notFound("Lote de consignación no encontrado");

  const reviewId = await prisma.$transaction(
    async (tx) => {
      // Lock de fila del lote: serializa revisiones simultáneas sobre el mismo
      // lote, así el "pendiente" que se valida abajo nunca es un valor viejo.
      const lockedLot = await tx.consignmentLot.findUniqueOrThrow({ where: { id: lotId }, select: { notes: true } });
      await tx.consignmentLot.update({ where: { id: lotId }, data: { notes: lockedLot.notes } });

      const lot = await tx.consignmentLot.findUniqueOrThrow({
        where: { id: lotId },
        include: {
          lines: { include: { reviewLines: { select: { quantitySold: true, quantityReturned: true } } } },
        },
      });
      if (lot.status === ConsignmentStatus.CERRADO) throw conflict("El lote ya está cerrado.");

      const now = new Date();
      const nextReviewDate = addDays(now, lot.reviewIntervalDays);

      // EXTENDER: sin cargo, el lote sigue abierto, siguiente revisión +N días
      // desde este registro.
      if (data.action === ReviewAction.EXTENDER) {
        const review = await tx.consignmentReview.create({
          data: {
            lotId,
            reviewedAt: now,
            scheduledFor: lot.nextReviewDate,
            action: ReviewAction.EXTENDER,
            nextReviewDate,
            notes: data.notes,
            registeredById: userId,
          },
        });
        await tx.consignmentLot.update({ where: { id: lotId }, data: { nextReviewDate } });
        return review.id;
      }

      // LIQUIDAR
      const lineById = new Map(lot.lines.map((l) => [l.id, l]));
      const seen = new Set<string>();
      for (const rl of data.lines) {
        const line = lineById.get(rl.lineId);
        if (!line) throw badRequest(`La línea ${rl.lineId} no pertenece a este lote.`, { field: "lines" });
        if (seen.has(rl.lineId)) throw badRequest("Hay líneas repetidas en la liquidación.", { field: "lines" });
        seen.add(rl.lineId);

        const { pending } = summarizeLine(line);
        if (rl.quantitySold + rl.quantityReturned === 0) {
          throw badRequest("Cada línea de la liquidación debe tener vendidas o devueltas mayores a 0.", { field: "lines" });
        }
        if (rl.quantitySold + rl.quantityReturned > pending) {
          throw badRequest(`Las cantidades superan lo pendiente de la línea (pendiente: ${pending}).`, { field: "lines" });
        }
      }

      const totalSold = data.lines.reduce((s, l) => s + l.quantitySold, 0);
      const totalReturned = data.lines.reduce((s, l) => s + l.quantityReturned, 0);
      const pendingAfter =
        lot.lines.reduce((s, l) => s + summarizeLine(l).pending, 0) - totalSold - totalReturned;
      const closes = pendingAfter === 0;

      // Contador de órdenes primero (mismo orden de locks que el resto).
      const orderNumber = totalSold > 0 ? await generateOrderNumber(tx) : undefined;

      const review = await tx.consignmentReview.create({
        data: {
          lotId,
          reviewedAt: now,
          scheduledFor: lot.nextReviewDate,
          action: ReviewAction.LIQUIDAR,
          nextReviewDate: closes ? null : nextReviewDate,
          notes: data.notes,
          registeredById: userId,
          lines: { create: data.lines },
        },
      });

      // Cargo a crédito por lo VENDIDO (una DispatchOrder real → Cuentas por
      // Cobrar y Payment funcionan sin cambios). Nace DESPACHADO y SIN movimiento
      // de stock: la mercadería ya salió al entregar el lote.
      if (totalSold > 0) {
        await tx.dispatchOrder.create({
          data: {
            orderNumber: orderNumber!,
            origin: DispatchOrderOrigin.CONSIGNACION_LIQUIDACION,
            consignmentReviewId: review.id,
            buyerType: "MAYORISTA",
            wholesalerId: lot.wholesalerId,
            shippingProvince: lot.shippingProvince,
            shippingCity: lot.shippingCity,
            status: DispatchStatus.DESPACHADO,
            dispatchDate: now,
            paymentMethod: PaymentMethod.CREDITO,
            creditDays: lot.creditDays,
            dueDate: addDays(now, lot.creditDays),
            notes: `Liquidación de consignación ${lot.code}`,
            createdById: userId,
            items: {
              create: data.lines
                .filter((l) => l.quantitySold > 0)
                .map((l) => {
                  const line = lineById.get(l.lineId)!;
                  return {
                    variantId: line.variantId,
                    quantity: l.quantitySold,
                    priceType: "MAYORISTA" as const,
                    unitPrice: line.unitPrice,
                    locationId: line.originLocationId ?? undefined,
                    unitCostSnapshot: line.unitCostSnapshot ?? undefined,
                    landedCostSnapshot: line.landedCostSnapshot ?? undefined,
                  };
                }),
            },
          },
        });
      }

      // Lo devuelto queda en Cuarentena, pendiente de checklist.
      if (totalReturned > 0) {
        await createReturnBatch(tx, {
          source: ReturnSource.CONSIGNACION,
          reviewId: review.id,
          lines: data.lines
            .filter((l) => l.quantityReturned > 0)
            .map((l) => {
              const line = lineById.get(l.lineId)!;
              return {
                variantId: line.variantId,
                quantity: l.quantityReturned,
                unitPrice: line.unitPrice,
                originLocationId: line.originLocationId,
                originMovementId: line.deliveryMovementId,
              };
            }),
        });
      }

      await tx.consignmentLot.update({
        where: { id: lotId },
        data: closes
          ? { status: ConsignmentStatus.CERRADO }
          : { status: ConsignmentStatus.LIQUIDADO_PARCIAL, nextReviewDate },
      });

      return review.id;
    },
    { timeout: 20000 }
  );

  const lot = await getLot(lotId);
  return { review: lot.reviews.find((r) => r.id === reviewId)!, lot };
}
