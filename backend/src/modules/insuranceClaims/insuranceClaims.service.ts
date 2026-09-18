import { ClaimStatus, CustomerResolution, PaymentMethod, PaymentStatus, Prisma, Role } from "@prisma/client";
import { generateOrderNumber } from "../../lib/orderNumber";
import { recalculatePaymentStatus } from "../../lib/paymentRecalculation";
import { prisma } from "../../lib/prisma";
import { reserveStock } from "../../lib/stockReservation";
import { conflict, notFound } from "../../utils/httpError";
import { serializeDispatchOrderForRole } from "../dispatchOrders/dispatchOrders.serializer";

async function getClaimWithOrderOrThrow(claimId: string) {
  const claim = await prisma.insuranceClaim.findUnique({
    where: { id: claimId },
    include: {
      shipment: {
        include: {
          dispatchOrder: { include: { items: true } },
        },
      },
    },
  });
  if (!claim) throw notFound("Reclamo no encontrado");
  return claim;
}

interface ResolveCustomerInput {
  resolution: "REPLACEMENT" | "REFUND";
  refundAmount?: number;
}

export async function resolveCustomer(
  claimId: string,
  data: ResolveCustomerInput,
  userId: string | undefined,
  role: Role
) {
  const claim = await getClaimWithOrderOrThrow(claimId);

  if (claim.customerResolution !== CustomerResolution.PENDIENTE) {
    throw conflict(
      `La resolución con el cliente ya fue registrada (actual: ${claim.customerResolution}).`
    );
  }

  const originalOrder = claim.shipment.dispatchOrder;

  if (data.resolution === "REPLACEMENT") {
    // Si la original ya está PAGADO, el cliente no vuelve a pagar: la nueva
    // orden sale con unitPrice=0 en todos sus items, lo que hace que
    // codAmountExpected salga en 0 automáticamente el día que se confirme
    // (mismo cálculo de siempre en /confirm, sin lógica especial nueva).
    const isOriginalPaid = originalOrder.paymentStatus === PaymentStatus.PAGADO;

    const result = await prisma.$transaction(async (tx) => {
      const orderNumber = await generateOrderNumber(tx);

      const replacementOrder = await tx.dispatchOrder.create({
        data: {
          orderNumber,
          buyerType: originalOrder.buyerType,
          wholesalerId: originalOrder.wholesalerId,
          finalCustomerId: originalOrder.finalCustomerId,
          shippingProvince: originalOrder.shippingProvince,
          shippingCity: originalOrder.shippingCity,
          paymentMethod: PaymentMethod.CONTRA_ENTREGA,
          replacesOrderId: originalOrder.id,
          createdById: userId,
          items: {
            // Estos items NO pasan por createDispatchOrderSchema/
            // createDispatchOrder: vienen de un DispatchOrderItem ya
            // persistido y válido (quantity>0 y variantId ya garantizados
            // por la orden original), no de un body HTTP no confiable.
            // priceType/discountPct se copian tal cual (registro/reporte),
            // aunque no participen en ningún cálculo acá.
            create: originalOrder.items.map((item) => ({
              variantId: item.variantId,
              quantity: item.quantity,
              priceType: item.priceType,
              unitPrice: isOriginalPaid ? 0 : item.unitPrice,
              discountPct: item.discountPct,
            })),
          },
        },
        include: { items: true },
      });

      // Todo o nada: si falta stock de alguna variante, reserveStock lanza
      // badRequest DENTRO de la transacción — revierte también la orden
      // recién creada y el update del reclamo de abajo, nunca queda a medias.
      for (const item of originalOrder.items) {
        await reserveStock(tx, item.variantId, item.quantity);
      }

      const updatedClaim = await tx.insuranceClaim.update({
        where: { id: claimId },
        data: { customerResolution: CustomerResolution.REEMPLAZO },
      });

      return { replacementOrder, updatedClaim };
    }, { timeout: 20000 }); // ver el mismo comentario en createDispatchOrder (dispatchOrders.service.ts)

    return {
      insuranceClaim: result.updatedClaim,
      replacementOrder: serializeDispatchOrderForRole(result.replacementOrder, role),
    };
  }

  // REFUND: Payment con amount negativo en la orden ORIGINAL, trazado al
  // reclamo vía insuranceClaimId.
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        dispatchOrderId: originalOrder.id,
        amount: new Prisma.Decimal(data.refundAmount!).negated(),
        method: "reembolso",
        paidAt: new Date(),
        notes: `Reembolso por reclamo ${claimId}`,
        insuranceClaimId: claimId,
        createdById: userId,
      },
    });

    // paymentStatus puede RETROCEDER (ej: de PAGADO a PARCIAL/PENDIENTE) —
    // mismo recalculatePaymentStatus que usa todo el resto del sistema, sin
    // lógica especial: solo vuelve a sumar todos los Payment de la orden, y
    // este es negativo.
    const updatedOrder = await recalculatePaymentStatus(tx, originalOrder.id);

    const updatedClaim = await tx.insuranceClaim.update({
      where: { id: claimId },
      data: { customerResolution: CustomerResolution.REEMBOLSO },
    });

    return { payment, updatedOrder, updatedClaim };
  });

  // updatedOrder viene de recalculatePaymentStatus, que no trae `items`
  // (no hay nada que enmascarar por rol acá, a diferencia del REPLACEMENT).
  return {
    insuranceClaim: result.updatedClaim,
    payment: result.payment,
    dispatchOrder: result.updatedOrder,
  };
}

interface UpdateClaimInput {
  status: ClaimStatus;
  reimbursedAmount?: number;
}

export async function updateInsuranceClaim(claimId: string, data: UpdateClaimInput) {
  const claim = await prisma.insuranceClaim.findUnique({ where: { id: claimId } });
  if (!claim) throw notFound("Reclamo no encontrado");

  const isClosing = data.status === ClaimStatus.PAGADO || data.status === ClaimStatus.RECHAZADO;

  return prisma.insuranceClaim.update({
    where: { id: claimId },
    data: {
      status: data.status,
      reimbursedAmount: data.reimbursedAmount,
      resolvedDate: isClosing ? new Date() : claim.resolvedDate,
    },
  });
}

interface ListClaimsParams {
  page: number;
  pageSize: number;
  courierId?: string;
  status?: ClaimStatus;
  customerResolution?: CustomerResolution;
  overdue?: boolean;
  open?: boolean;
  shipmentId?: string;
}

// "Abierto" = no cerrado ante el courier todavía (ni aprobado, ni pagado, ni
// rechazado) — mismo criterio que usa `overdue`, el bloque pendingByCourier,
// el filtro `open`, y GET /dashboard/summary (reclamos en proceso). Se
// exporta para que el dashboard cuente exactamente lo mismo que este módulo,
// sin reinventar la definición de "en proceso".
export const OPEN_STATUSES: ClaimStatus[] = [ClaimStatus.PENDIENTE, ClaimStatus.EN_REVISION];

export async function listInsuranceClaims(params: ListClaimsParams) {
  const { page, pageSize, courierId, status, customerResolution, overdue, open, shipmentId } = params;

  const where: Prisma.InsuranceClaimWhereInput = {};
  if (customerResolution) where.customerResolution = customerResolution;
  // courierId y shipmentId son dos condiciones DISTINTAS sobre la misma
  // relación (shipment) — deben combinarse en un solo objeto, nunca
  // pisarse una a la otra si algún día se usan juntos.
  if (courierId || shipmentId) {
    where.shipment = { ...(courierId && { courierId }), ...(shipmentId && { id: shipmentId }) };
  }
  if (open) where.status = { in: OPEN_STATUSES };
  if (overdue) {
    where.expectedResolutionDate = { lt: new Date() };
    where.status = { notIn: [ClaimStatus.APROBADO, ClaimStatus.PAGADO, ClaimStatus.RECHAZADO] };
  }
  // Un status explícito siempre gana sobre los filtros implícitos de arriba.
  if (status) where.status = status;

  const [rows, total, openClaims] = await Promise.all([
    prisma.insuranceClaim.findMany({
      where,
      orderBy: { claimDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        shipment: {
          include: {
            courier: { select: { id: true, name: true } },
            dispatchOrder: { select: { id: true, orderNumber: true } },
          },
        },
      },
    }),
    prisma.insuranceClaim.count({ where }),
    // pendingByCourier es GLOBAL (no se filtra por los query params de la
    // lista): es el "de un vistazo" de cuánto debe cada courier ahora mismo,
    // independiente de qué página/filtro esté mirando el usuario.
    prisma.insuranceClaim.findMany({
      where: { status: { in: OPEN_STATUSES } },
      select: {
        claimAmount: true,
        shipment: { select: { courierId: true, courier: { select: { name: true } } } },
      },
    }),
  ]);

  const pendingByCourierMap = new Map<
    string,
    { courierId: string; courierName: string; totalPending: Prisma.Decimal }
  >();
  for (const claim of openClaims) {
    const { courierId: cId, courier } = claim.shipment;
    const existing = pendingByCourierMap.get(cId);
    if (existing) {
      existing.totalPending = existing.totalPending.plus(claim.claimAmount);
    } else {
      pendingByCourierMap.set(cId, { courierId: cId, courierName: courier.name, totalPending: claim.claimAmount });
    }
  }

  return {
    data: rows,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    pendingByCourier: [...pendingByCourierMap.values()].map((p) => ({
      courierId: p.courierId,
      courierName: p.courierName,
      totalPending: p.totalPending.toDecimalPlaces(2),
    })),
  };
}
