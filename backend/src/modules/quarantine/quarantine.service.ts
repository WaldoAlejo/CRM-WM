// Bodega de Cuarentena/Validación: recibe devoluciones (lo no vendido de una
// consignación y los envíos de courier RECHAZADOS) y las mantiene "pendientes
// de checklist" hasta que un OPERATOR (o superior) las inspecciona.
//
// Mientras esperan, las unidades NO están en `stock` ni en el ledger: no son
// vendibles ni reservables, y no hay movimiento que altere el costo promedio.
// - PASA  → DEVOLUCION a la MISMA ubicación de origen, enlazado al movimiento
//           original (CONSIGNACION / SALIDA). Nunca es un INGRESO nuevo.
// - NO_PASA → sin movimiento de stock; al terminar la inspección del lote se
//           genera el cargo (mayorista: DispatchOrder a crédito; courier:
//           InsuranceClaim con el mismo cálculo de hoy, Σ unitPrice × cantidad).
import {
  ClaimStatus,
  DispatchOrderOrigin,
  DispatchStatus,
  InspectionResult,
  LocationType,
  MovementType,
  PaymentMethod,
  Prisma,
  ReturnSource,
} from "@prisma/client";
import { applyMovement } from "../../lib/inventoryMovements";
import { computeOrderTotal } from "../../lib/paymentRecalculation";
import { generateOrderNumber } from "../../lib/orderNumber";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, notFound } from "../../utils/httpError";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReturnLineInput {
  variantId: string;
  quantity: number;
  unitPrice: Prisma.Decimal | number;
  originLocationId?: string | null;
  originMovementId?: string | null;
}

// Crea el lote de devolución y sus líneas dentro de la transacción del llamante.
// Cada línea espera en la Cuarentena de la bodega de su ubicación de origen; si
// la bodega no tiene una activa → 409 (el sistema no puede recibir la
// devolución). Si el ítem no tenía ubicación de origen (courier sin
// locationId), queda en la cola sin ubicación de cuarentena asignada.
export async function createReturnBatch(
  tx: Prisma.TransactionClient,
  input: { source: ReturnSource; reviewId?: string; shipmentId?: string; lines: ReturnLineInput[] }
) {
  if (Boolean(input.reviewId) === Boolean(input.shipmentId)) {
    throw new Error("createReturnBatch: se requiere exactamente uno de reviewId / shipmentId");
  }

  const originIds = [...new Set(input.lines.map((l) => l.originLocationId).filter((id): id is string => !!id))];
  const origins = await tx.location.findMany({ where: { id: { in: originIds } }, select: { id: true, warehouseId: true } });
  const warehouseByLocation = new Map(origins.map((l) => [l.id, l.warehouseId]));

  const warehouseIds = [...new Set(origins.map((l) => l.warehouseId))];
  const quarantines = await tx.location.findMany({
    where: { warehouseId: { in: warehouseIds }, type: LocationType.CUARENTENA, isActive: true },
    select: { id: true, warehouseId: true },
  });
  const quarantineByWarehouse = new Map(quarantines.map((q) => [q.warehouseId, q.id]));

  const missingWarehouse = warehouseIds.find((w) => !quarantineByWarehouse.has(w));
  if (missingWarehouse) {
    throw conflict(
      "La bodega no tiene una ubicación de Cuarentena activa: no se puede recibir la devolución. Crea/activa la Cuarentena de la bodega primero.",
      { warehouseId: missingWarehouse }
    );
  }

  return tx.returnBatch.create({
    data: {
      source: input.source,
      reviewId: input.reviewId,
      shipmentId: input.shipmentId,
      lines: {
        create: input.lines.map((l) => {
          const warehouseId = l.originLocationId ? warehouseByLocation.get(l.originLocationId) : undefined;
          return {
            variantId: l.variantId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            originLocationId: l.originLocationId ?? undefined,
            originMovementId: l.originMovementId ?? undefined,
            quarantineLocationId: warehouseId ? quarantineByWarehouse.get(warehouseId) : undefined,
          };
        }),
      },
    },
    include: { lines: true },
  });
}

// ---------------------------------------------------------------------------
// Cola de unidades pendientes de checklist. Nunca expone precios (la ve
// OPERATOR): solo lo necesario para inspeccionar.
// ---------------------------------------------------------------------------

interface QueueParams {
  page: number;
  pageSize: number;
  source?: ReturnSource;
  warehouseId?: string;
}

export async function listQuarantineQueue(params: QueueParams) {
  const { page, pageSize, source, warehouseId } = params;

  const rows = await prisma.returnLine.findMany({
    where: {
      batch: { completedAt: null, ...(source && { source }) },
      ...(warehouseId && { quarantineLocation: { warehouseId } }),
    },
    orderBy: [{ batch: { createdAt: "asc" } }, { id: "asc" }],
    select: {
      id: true,
      batchId: true,
      quantity: true,
      inspectedQuantity: true,
      variant: {
        select: {
          id: true,
          sku: true,
          label: true,
          images: { select: { url: true }, orderBy: { position: "asc" }, take: 1 },
          product: {
            select: { name: true, images: { select: { url: true }, orderBy: { position: "asc" }, take: 1 } },
          },
        },
      },
      originLocation: { select: { id: true, code: true } },
      quarantineLocation: { select: { id: true, code: true, warehouse: { select: { id: true, name: true } } } },
      batch: {
        select: {
          source: true,
          createdAt: true,
          review: { select: { lot: { select: { code: true, wholesaler: { select: { businessName: true } } } } } },
          shipment: { select: { dispatchOrder: { select: { orderNumber: true } } } },
        },
      },
    },
  });

  // Las líneas ya inspeccionadas por completo dentro de un lote todavía
  // abierto no son trabajo pendiente: se filtran acá (Prisma no compara dos
  // columnas en un where). Volumen chico (devoluciones activas), sin problema.
  const pending = rows.filter((r) => r.inspectedQuantity < r.quantity);
  const total = pending.length;
  const start = (page - 1) * pageSize;

  const data = pending.slice(start, start + pageSize).map((r) => ({
    id: r.id,
    batchId: r.batchId,
    source: r.batch.source,
    reference:
      r.batch.source === ReturnSource.CONSIGNACION
        ? (r.batch.review?.lot.code ?? null)
        : (r.batch.shipment?.dispatchOrder.orderNumber ?? null),
    wholesalerName: r.batch.review?.lot.wholesaler.businessName ?? null,
    variant: {
      id: r.variant.id,
      sku: r.variant.sku,
      label: r.variant.label,
      productName: r.variant.product.name,
      imageUrl: r.variant.images[0]?.url ?? r.variant.product.images[0]?.url ?? null,
    },
    quantity: r.quantity,
    inspectedQuantity: r.inspectedQuantity,
    remaining: r.quantity - r.inspectedQuantity,
    originLocation: r.originLocation,
    quarantineLocation: r.quarantineLocation,
    receivedAt: r.batch.createdAt,
  }));

  return { data, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

export interface InspectionInput {
  quantity: number;
  boxOk: boolean;
  noVisibleDamage: boolean;
  piecesComplete: boolean;
  observation?: string;
}

export async function inspectReturnLine(lineId: string, data: InspectionInput, userId: string | undefined) {
  const head = await prisma.returnLine.findUnique({ where: { id: lineId }, select: { batchId: true } });
  if (!head) throw notFound("Línea de devolución no encontrada");

  // El resultado lo decide el servidor a partir de los ítems fijos (nunca lo
  // envía el cliente): PASA solo si los tres están OK.
  const result = data.boxOk && data.noVisibleDamage && data.piecesComplete ? InspectionResult.PASA : InspectionResult.NO_PASA;

  return prisma.$transaction(
    async (tx) => {
      // Lock de fila del lote durante toda la transacción: serializa las
      // inspecciones de un mismo lote, así el chequeo "¿era la última unidad?"
      // ve siempre el estado ya confirmado por la inspección anterior (sin esto,
      // dos últimas inspecciones simultáneas de líneas distintas podrían no
      // ver la del otro y el lote nunca se marcaría como completo).
      const { source } = await tx.returnBatch.findUniqueOrThrow({ where: { id: head.batchId }, select: { source: true } });
      await tx.returnBatch.update({ where: { id: head.batchId }, data: { source } });

      const batch = await tx.returnBatch.findUniqueOrThrow({
        where: { id: head.batchId },
        include: {
          lines: { include: { inspections: { select: { result: true, quantity: true } } } },
          review: { include: { lot: { include: { lines: true } } } },
        },
      });

      const line = batch.lines.find((l) => l.id === lineId)!;
      const remaining = line.quantity - line.inspectedQuantity;
      if (remaining <= 0) throw conflict("Esta línea ya fue inspeccionada por completo.");
      if (data.quantity > remaining) {
        throw badRequest(`La cantidad supera lo pendiente de esta línea (pendientes: ${remaining}).`, { field: "quantity" });
      }

      const totalRemainingAfter =
        batch.lines.reduce((sum, l) => sum + (l.quantity - l.inspectedQuantity), 0) - data.quantity;
      const completes = totalRemainingAfter === 0;

      const failedQtyByLine = new Map<string, number>();
      for (const l of batch.lines) {
        const failed = l.inspections.filter((i) => i.result === InspectionResult.NO_PASA).reduce((s, i) => s + i.quantity, 0);
        failedQtyByLine.set(l.id, failed + (l.id === lineId && result === InspectionResult.NO_PASA ? data.quantity : 0));
      }
      const anyFailed = [...failedQtyByLine.values()].some((q) => q > 0);

      // Orden de locks: el número de orden (contador) se toma ANTES de que
      // applyMovement bloquee la variante — mismo orden que createDispatchOrder
      // (contador → variante), para no crear un ciclo de espera entre ambos.
      let chargeOrderNumber: string | undefined;
      if (completes && anyFailed && batch.source === ReturnSource.CONSIGNACION) {
        chargeOrderNumber = await generateOrderNumber(tx);
      }

      let reentryMovementId: string | undefined;
      if (result === InspectionResult.PASA) {
        const origin = line.originMovementId
          ? await tx.inventoryMovement.findUnique({ where: { id: line.originMovementId }, select: { dispatchOrderItemId: true } })
          : null;
        const movement = await applyMovement(tx, {
          variantId: line.variantId,
          type: MovementType.DEVOLUCION,
          quantity: data.quantity,
          locationId: line.originLocationId ?? undefined,
          dispatchOrderItemId: origin?.dispatchOrderItemId ?? undefined,
          notes: "Reingreso tras checklist de Cuarentena",
          createdById: userId,
        });
        // Mismo movimiento de origen: trazabilidad sin tratarlo como ingreso nuevo.
        await tx.inventoryMovement.update({
          where: { id: movement.id },
          data: { originMovementId: line.originMovementId ?? undefined },
        });
        reentryMovementId = movement.id;
      }

      const inspection = await tx.returnInspection.create({
        data: {
          returnLineId: lineId,
          quantity: data.quantity,
          boxOk: data.boxOk,
          noVisibleDamage: data.noVisibleDamage,
          piecesComplete: data.piecesComplete,
          observation: data.observation,
          result,
          reentryMovementId,
          inspectedById: userId,
        },
      });

      const updatedLine = await tx.returnLine.update({
        where: { id: lineId },
        data: { inspectedQuantity: { increment: data.quantity } },
      });

      let chargeGenerated = false;
      if (completes) {
        await tx.returnBatch.update({ where: { id: batch.id }, data: { completedAt: new Date() } });

        if (anyFailed && batch.source === ReturnSource.CONSIGNACION) {
          const lot = batch.review!.lot;
          const now = new Date();
          const items = batch.lines
            .filter((l) => (failedQtyByLine.get(l.id) ?? 0) > 0)
            .map((l) => {
              const lotLine = lot.lines.find((x) => x.variantId === l.variantId);
              return {
                variantId: l.variantId,
                quantity: failedQtyByLine.get(l.id)!,
                priceType: "MAYORISTA" as const,
                unitPrice: l.unitPrice,
                locationId: l.originLocationId ?? undefined,
                unitCostSnapshot: lotLine?.unitCostSnapshot ?? undefined,
                landedCostSnapshot: lotLine?.landedCostSnapshot ?? undefined,
              };
            });

          // Segundo cargo: el mayorista paga lo no conforme como si lo hubiera
          // vendido (mismo precio congelado). Vence creditDays desde la
          // fecha de inspección, no desde la liquidación.
          await tx.dispatchOrder.create({
            data: {
              orderNumber: chargeOrderNumber!,
              origin: DispatchOrderOrigin.CONSIGNACION_DEVOLUCION_NO_CONFORME,
              returnBatchId: batch.id,
              buyerType: "MAYORISTA",
              wholesalerId: lot.wholesalerId,
              shippingProvince: lot.shippingProvince,
              shippingCity: lot.shippingCity,
              status: DispatchStatus.DESPACHADO,
              dispatchDate: now,
              paymentMethod: PaymentMethod.CREDITO,
              creditDays: lot.creditDays,
              dueDate: new Date(now.getTime() + lot.creditDays * DAY_MS),
              notes: `Devolución no conforme — lote ${lot.code}`,
              createdById: userId,
              items: { create: items },
            },
          });
          chargeGenerated = true;
        }

        if (anyFailed && batch.source === ReturnSource.COURIER_RECHAZADO) {
          // Idéntico a perdido/dañado: computeOrderTotal (Σ unitPrice × cantidad,
          // Decimal) sobre el unitPrice de la orden ORIGINAL que generó el envío
          // (copiado a la línea al rechazar) — el valor facturado, no un PVP de
          // lista. Solo cuentan las unidades que no pasaron el checklist.
          const claimAmount = computeOrderTotal(
            batch.lines.map((l) => ({ unitPrice: l.unitPrice, quantity: failedQtyByLine.get(l.id) ?? 0 }))
          );
          const claimDate = new Date();
          await tx.insuranceClaim.create({
            data: {
              shipmentId: batch.shipmentId!,
              claimAmount,
              status: ClaimStatus.PENDIENTE,
              claimDate,
              expectedResolutionDate: new Date(claimDate.getTime() + 20 * DAY_MS),
              notes: "Devolución rechazada que no pasó el checklist de Cuarentena",
            },
          });
          chargeGenerated = true;
        }
      }

      return {
        inspection,
        line: {
          id: updatedLine.id,
          quantity: updatedLine.quantity,
          inspectedQuantity: updatedLine.inspectedQuantity,
          remaining: updatedLine.quantity - updatedLine.inspectedQuantity,
        },
        batchCompleted: completes,
        // Solo un booleano: los montos son precios y esto lo ve OPERATOR.
        chargeGenerated,
      };
    },
    { timeout: 20000 }
  );
}
