import { ClaimStatus, MovementType, ReturnSource, ShipmentStatus } from "@prisma/client";
import { recalculatePaymentStatus } from "../../lib/paymentRecalculation";
import { prisma } from "../../lib/prisma";
import { conflict, notFound } from "../../utils/httpError";
import { computeOrderTotal } from "../../lib/paymentRecalculation";
import { createReturnBatch } from "../quarantine/quarantine.service";

async function getShipmentOrThrow(shipmentId: string) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { dispatchOrder: { include: { items: true } } },
  });
  if (!shipment) throw notFound("Envío no encontrado");
  return shipment;
}

function assertInTransit(status: ShipmentStatus) {
  if (status !== ShipmentStatus.EN_TRANSITO) {
    throw conflict(`El envío no está en estado EN_TRANSITO (actual: ${status}).`);
  }
}

export async function deliverShipment(
  shipmentId: string,
  codAmountCollected: number,
  userId: string | undefined
) {
  const shipment = await getShipmentOrThrow(shipmentId);
  assertInTransit(shipment.status);

  return prisma.$transaction(async (tx) => {
    const updatedShipment = await tx.shipment.update({
      where: { id: shipmentId },
      data: { status: ShipmentStatus.ENTREGADO, deliveredAt: new Date(), codAmountCollected },
    });

    await tx.payment.create({
      data: {
        dispatchOrderId: shipment.dispatchOrderId,
        amount: codAmountCollected,
        method: "cobro courier",
        paidAt: new Date(),
        createdById: userId,
      },
    });

    const dispatchOrder = await recalculatePaymentStatus(tx, shipment.dispatchOrderId);

    return { shipment: updatedShipment, dispatchOrder };
  });
}

export async function rejectShipment(
  shipmentId: string,
  rejectionReason: string,
  _userId: string | undefined
) {
  const shipment = await getShipmentOrThrow(shipmentId);
  assertInTransit(shipment.status);

  return prisma.$transaction(async (tx) => {
    const updatedShipment = await tx.shipment.update({
      where: { id: shipmentId },
      data: { status: ShipmentStatus.RECHAZADO, rejectionReason },
    });

    // El producto ya NO vuelve directo a stock: pasa primero por la bodega de
    // Cuarentena/Validación y queda pendiente de checklist (lo completa
    // OPERATOR, ver módulo quarantine). Si el checklist PASA, se aplica el
    // DEVOLUCION a item.locationId (la ubicación de origen de la SALIDA, igual
    // que antes) con referencia a esa SALIDA; si NO PASA, el courier paga el
    // valor de venta vía InsuranceClaim (mismo cálculo que perdido/dañado).
    // (`_userId` no se usa: el usuario relevante es quien inspecciona.)
    const salidas = await tx.inventoryMovement.findMany({
      where: {
        type: MovementType.SALIDA,
        dispatchOrderItemId: { in: shipment.dispatchOrder.items.map((i) => i.id) },
      },
      select: { id: true, dispatchOrderItemId: true },
    });
    const salidaByItem = new Map(salidas.map((m) => [m.dispatchOrderItemId, m.id]));

    await createReturnBatch(tx, {
      source: ReturnSource.COURIER_RECHAZADO,
      shipmentId,
      lines: shipment.dispatchOrder.items.map((item) => ({
        variantId: item.variantId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        originLocationId: item.locationId,
        originMovementId: salidaByItem.get(item.id),
      })),
    });

    return updatedShipment;
  });
}

export async function markShipmentLostOrDamaged(
  shipmentId: string,
  status: "PERDIDO" | "DANADO",
  _userId: string | undefined
) {
  const shipment = await getShipmentOrThrow(shipmentId);
  assertInTransit(shipment.status);

  // Sin InventoryMovement acá a propósito (ver el comentario de SINIESTRO en
  // schema.prisma): el SALIDA que ya se aplicó al confirmar la orden ya
  // sacó estas unidades de `stock` de forma correcta y definitiva — crear
  // otro movimiento acá las restaría dos veces.
  //
  // claimAmount = Σ(unitPrice × quantity), calculado con computeOrderTotal: la
  // MISMA función (aritmética Decimal) que calcula el total de la orden, o sea
  // el valor de la factura emitida al cliente final. La aseguradora exige esa
  // factura como respaldo, así que es el precio real de venta de ESTA orden
  // (unitPrice congelado, ya neto de descuento), nunca un PVP de lista ni el
  // costo. El rechazado-no-conforme de Cuarentena usa esta misma función.
  const claimAmount = computeOrderTotal(shipment.dispatchOrder.items);
  const claimDate = new Date();
  const expectedResolutionDate = new Date(claimDate.getTime() + 20 * 24 * 60 * 60 * 1000);

  return prisma.$transaction(async (tx) => {
    const updatedShipment = await tx.shipment.update({
      where: { id: shipmentId },
      data: { status: status === "PERDIDO" ? ShipmentStatus.PERDIDO : ShipmentStatus.DANADO },
    });

    const insuranceClaim = await tx.insuranceClaim.create({
      data: {
        shipmentId,
        claimAmount,
        status: ClaimStatus.PENDIENTE,
        claimDate,
        expectedResolutionDate,
      },
    });

    return { shipment: updatedShipment, insuranceClaim };
  });
}
