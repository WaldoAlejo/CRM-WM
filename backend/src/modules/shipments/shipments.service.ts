import { ClaimStatus, MovementType, ShipmentStatus } from "@prisma/client";
import { applyMovement } from "../../lib/inventoryMovements";
import { recalculatePaymentStatus } from "../../lib/paymentRecalculation";
import { prisma } from "../../lib/prisma";
import { conflict, notFound } from "../../utils/httpError";

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
  userId: string | undefined
) {
  const shipment = await getShipmentOrThrow(shipmentId);
  assertInTransit(shipment.status);

  return prisma.$transaction(async (tx) => {
    const updatedShipment = await tx.shipment.update({
      where: { id: shipmentId },
      data: { status: ShipmentStatus.RECHAZADO, rejectionReason },
    });

    // El producto vuelve físicamente a bodega: DEVOLUCION en signo positivo,
    // por cada ítem de la orden (mismo patrón que la SALIDA original).
    for (const item of shipment.dispatchOrder.items) {
      await applyMovement(tx, {
        variantId: item.variantId,
        type: MovementType.DEVOLUCION,
        quantity: item.quantity,
        dispatchOrderItemId: item.id,
        createdById: userId,
      });
    }

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
  // claimAmount = Σ(unitPrice × quantity): lo que el courier debe devolver a
  // WM es el valor de la VENTA que se frustró, no el costo de fábrica.
  // unitPrice ya viene neto (con descuento aplicado, según la definición
  // original del campo) — no se vuelve a aplicar discountPct.
  const claimAmount = shipment.dispatchOrder.items.reduce(
    (sum, item) => sum + Number(item.unitPrice) * item.quantity,
    0
  );
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
