import {
  BuyerType,
  DispatchStatus,
  MovementType,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  Role,
  ShipmentStatus,
} from "@prisma/client";
import { applyMovement, computeLandedCost, computeWeightedAverageCost } from "../../lib/inventoryMovements";
import { generateOrderNumber } from "../../lib/orderNumber";
import { computeOrderTotal, recalculatePaymentStatus } from "../../lib/paymentRecalculation";
import { prisma } from "../../lib/prisma";
import { reserveStock, releaseStock } from "../../lib/stockReservation";
import { badRequest, conflict, notFound } from "../../utils/httpError";
import { serializeDispatchOrderForRole } from "./dispatchOrders.serializer";

interface CreateOrderItemInput {
  variantId: string;
  quantity: number;
  priceType: "MAYORISTA" | "PVP";
  unitPrice: number;
  discountPct?: number;
}

interface CreateOrderInput {
  buyerType: BuyerType;
  wholesalerId?: string;
  finalCustomerId?: string;
  shippingProvince: string;
  shippingCity: string;
  paymentMethod: PaymentMethod;
  creditDays?: number;
  notes?: string;
  items: CreateOrderItemInput[];
}

export async function createDispatchOrder(data: CreateOrderInput, userId: string | undefined, role: Role) {
  // Exactamente uno de wholesalerId/finalCustomerId, según buyerType (la
  // misma regla que ya protege el CHECK de la base, pero acá con un mensaje
  // claro en vez de dejar que una violación de CHECK caiga al 500 genérico).
  if (data.buyerType === BuyerType.MAYORISTA) {
    if (!data.wholesalerId || data.finalCustomerId) {
      throw badRequest("Para buyerType=MAYORISTA debes indicar wholesalerId y no finalCustomerId.");
    }
  } else {
    if (!data.finalCustomerId || data.wholesalerId) {
      throw badRequest("Para buyerType=CLIENTE_FINAL debes indicar finalCustomerId y no wholesalerId.");
    }
  }

  // El crédito es exclusivo de mayoristas por diseño de negocio (no
  // simplemente porque FinalCustomer carezca de defaultCreditDays).
  if (data.paymentMethod === PaymentMethod.CREDITO && data.buyerType === BuyerType.CLIENTE_FINAL) {
    throw badRequest("El crédito solo está disponible para compradores tipo MAYORISTA");
  }

  let wholesaler = null;
  if (data.wholesalerId) {
    wholesaler = await prisma.wholesaler.findFirst({
      where: { id: data.wholesalerId, deletedAt: null },
    });
    if (!wholesaler) throw notFound("Mayorista no encontrado");
  }
  if (data.finalCustomerId) {
    const finalCustomer = await prisma.finalCustomer.findFirst({
      where: { id: data.finalCustomerId, deletedAt: null },
    });
    if (!finalCustomer) throw notFound("Cliente final no encontrado");
  }

  // Sin variantId repetido: más simple y explícito que sumar cantidades
  // automáticamente.
  const occurrences = new Map<string, number>();
  for (const item of data.items) {
    occurrences.set(item.variantId, (occurrences.get(item.variantId) ?? 0) + 1);
  }
  const duplicatedId = [...occurrences.entries()].find(([, count]) => count > 1)?.[0];
  if (duplicatedId) {
    const dupVariant = await prisma.productVariant.findUnique({
      where: { id: duplicatedId },
      select: { sku: true },
    });
    throw badRequest(
      `El producto ${dupVariant?.sku ?? duplicatedId} aparece repetido en la orden. Combina las cantidades en una sola línea.`,
      { field: "items" }
    );
  }

  const variantIds = data.items.map((i) => i.variantId);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, deletedAt: null },
  });
  const foundIds = new Set(variants.map((v) => v.id));
  const missingIds = variantIds.filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) {
    throw badRequest(`Variantes no encontradas: ${missingIds.join(", ")}`, { field: "items" });
  }

  let creditDays: number | undefined;
  if (data.paymentMethod === PaymentMethod.CREDITO) {
    creditDays = data.creditDays ?? wholesaler?.defaultCreditDays ?? undefined;
    if (!creditDays) {
      throw badRequest(
        "creditDays es obligatorio para paymentMethod=CREDITO (el mayorista no tiene un valor por defecto)"
      );
    }
  }

  const order = await prisma.$transaction(
    async (tx) => {
      const orderNumber = await generateOrderNumber(tx);

      const created = await tx.dispatchOrder.create({
        data: {
          orderNumber,
          buyerType: data.buyerType,
          wholesalerId: data.wholesalerId,
          finalCustomerId: data.finalCustomerId,
          shippingProvince: data.shippingProvince,
          shippingCity: data.shippingCity,
          paymentMethod: data.paymentMethod,
          creditDays,
          notes: data.notes,
          createdById: userId,
          items: {
            create: data.items.map((item) => ({
              variantId: item.variantId,
              quantity: item.quantity,
              priceType: item.priceType,
              unitPrice: item.unitPrice,
              discountPct: item.discountPct,
            })),
          },
        },
        include: { items: true },
      });

      // Reserva DESPUÉS de crear la orden: si una línea no tiene stock
      // disponible, toda la transacción revierte (también se deshace la
      // orden recién creada) — todo o nada, igual que /receive.
      for (const item of data.items) {
        await reserveStock(tx, item.variantId, item.quantity);
      }

      return created;
    },
    // Timeout más generoso que el default de Prisma (5000ms): con tráfico
    // concurrente real, varias creaciones simultáneas se serializan en fila
    // por el lock de OrderNumberCounter (generateOrderNumber) — las últimas
    // de la cola podían superar el default y abortar con "Transaction
    // already closed" antes de que les tocara el turno (confirmado por el
    // test de 10 creaciones en paralelo). 20s cubre esa cola con margen sin
    // arriesgar nada en el uso normal (una creación sola tarda una fracción
    // de esto).
    { timeout: 20000 }
  );

  return serializeDispatchOrderForRole(order, role);
}

interface ConfirmOrderInput {
  courierId?: string;
  trackingNumber?: string;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function confirmDispatchOrder(
  orderId: string,
  data: ConfirmOrderInput,
  userId: string | undefined,
  role: Role
) {
  const order = await prisma.dispatchOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: { items: true },
  });
  if (!order) throw notFound("Orden no encontrada");

  if (order.status !== DispatchStatus.PENDIENTE) {
    // Cubre tanto "ya se canceló" como "reintento sobre una ya despachada":
    // rechazo explícito por estado, nunca un fallo confuso ni una
    // duplicación silenciosa de la salida de stock.
    throw conflict(`La orden no está en estado PENDIENTE (actual: ${order.status}).`);
  }

  if (order.paymentMethod === PaymentMethod.CONTRA_ENTREGA) {
    if (!data.courierId) {
      throw badRequest("courierId es obligatorio cuando paymentMethod=CONTRA_ENTREGA");
    }
    const courier = await prisma.courier.findUnique({ where: { id: data.courierId } });
    if (!courier) throw notFound("Courier no encontrado");
  }

  const dispatchDate = new Date();
  const dueDate =
    order.paymentMethod === PaymentMethod.CREDITO && order.creditDays
      ? addDays(dispatchDate, order.creditDays)
      : null;

  const result = await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      // El costo promedio ponderado y el costo de aterrizaje se calculan y se
      // congelan AHORA, en el momento exacto de confirmar — si el costo de
      // compra o el prorrateo de flete/aduana cambian después, los reportes
      // de ganancia de esta orden ya no se ven afectados. GET
      // /reports/profitability lee estos dos snapshots, nunca recalcula en
      // vivo.
      const [unitCostSnapshot, landedCostSnapshot] = await Promise.all([
        computeWeightedAverageCost(tx, item.variantId),
        computeLandedCost(tx, item.variantId),
      ]);
      await tx.dispatchOrderItem.update({
        where: { id: item.id },
        data: { unitCostSnapshot, landedCostSnapshot },
      });

      await releaseStock(tx, item.variantId, item.quantity);

      await applyMovement(tx, {
        variantId: item.variantId,
        type: MovementType.SALIDA,
        quantity: -item.quantity,
        dispatchOrderItemId: item.id,
        createdById: userId,
      });
    }

    const updatedOrder = await tx.dispatchOrder.update({
      where: { id: orderId },
      data: { status: DispatchStatus.DESPACHADO, dispatchDate, dueDate },
      include: { items: true },
    });

    let shipment = null;
    if (order.paymentMethod === PaymentMethod.CONTRA_ENTREGA) {
      const codAmountExpected = updatedOrder.items.reduce(
        (sum, item) => sum.plus(item.unitPrice.times(item.quantity)),
        new Prisma.Decimal(0)
      );
      shipment = await tx.shipment.create({
        data: {
          dispatchOrderId: orderId,
          courierId: data.courierId!,
          trackingNumber: data.trackingNumber,
          isCOD: true,
          codAmountExpected,
          status: ShipmentStatus.EN_TRANSITO,
        },
      });
    }

    return { ...updatedOrder, shipment };
  });

  return serializeDispatchOrderForRole(result, role);
}

export async function cancelDispatchOrder(orderId: string, role: Role) {
  const order = await prisma.dispatchOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: { items: true },
  });
  if (!order) throw notFound("Orden no encontrada");

  if (order.status !== DispatchStatus.PENDIENTE) {
    throw conflict(`La orden no está en estado PENDIENTE (actual: ${order.status}).`);
  }

  const result = await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      await releaseStock(tx, item.variantId, item.quantity);
    }
    return tx.dispatchOrder.update({
      where: { id: orderId },
      data: { status: DispatchStatus.CANCELADO },
      include: { items: true },
    });
  });

  return serializeDispatchOrderForRole(result, role);
}

interface ListOrdersParams {
  page: number;
  pageSize: number;
  status?: DispatchStatus;
  paymentMethod?: PaymentMethod;
  buyerType?: BuyerType;
  wholesalerId?: string;
  finalCustomerId?: string;
  shippingProvince?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export async function listDispatchOrders(params: ListOrdersParams) {
  const {
    page,
    pageSize,
    status,
    paymentMethod,
    buyerType,
    wholesalerId,
    finalCustomerId,
    shippingProvince,
    dateFrom,
    dateTo,
  } = params;

  const where: Prisma.DispatchOrderWhereInput = {
    deletedAt: null,
    ...(status && { status }),
    ...(paymentMethod && { paymentMethod }),
    ...(buyerType && { buyerType }),
    ...(wholesalerId && { wholesalerId }),
    ...(finalCustomerId && { finalCustomerId }),
    ...(shippingProvince && { shippingProvince }),
    ...((dateFrom || dateTo) && {
      createdAt: { ...(dateFrom && { gte: dateFrom }), ...(dateTo && { lte: dateTo }) },
    }),
  };

  const [rows, total] = await Promise.all([
    prisma.dispatchOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        wholesaler: { select: { id: true, businessName: true } },
        finalCustomer: { select: { id: true, fullName: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.dispatchOrder.count({ where }),
  ]);

  // El listado no trae items (mismo criterio que /products): sin
  // unitCostSnapshot expuesto acá porque directamente no hay nada que
  // enmascarar, solo itemsCount.
  return {
    data: rows.map(({ _count, ...order }) => ({ ...order, itemsCount: _count.items })),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function getDispatchOrderById(id: string, role: Role) {
  const order = await prisma.dispatchOrder.findFirst({
    where: { id, deletedAt: null },
    include: {
      wholesaler: { select: { id: true, businessName: true } },
      finalCustomer: { select: { id: true, fullName: true } },
      items: { include: { variant: { select: { sku: true, label: true } } } },
      payments: { orderBy: { paidAt: "desc" } },
      shipment: { include: { courier: { select: { id: true, name: true } }, claim: true } },
    },
  });
  if (!order) throw notFound("Orden no encontrada");

  // orderTotal viene de la MISMA función que recalcula paymentStatus al
  // registrar un pago — el detalle nunca reimplementa la fórmula de sumar
  // ítems, solo muestra lo que ya calculó el sistema.
  const orderTotal = computeOrderTotal(order.items);
  return serializeDispatchOrderForRole({ ...order, orderTotal }, role);
}

interface AddPaymentInput {
  amount: number;
  method: string;
  paidAt?: Date;
  notes?: string;
}

export async function addPayment(orderId: string, data: AddPaymentInput, userId: string | undefined) {
  const order = await prisma.dispatchOrder.findFirst({ where: { id: orderId, deletedAt: null } });
  if (!order) throw notFound("Orden no encontrada");

  return prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        dispatchOrderId: orderId,
        amount: data.amount,
        method: data.method,
        paidAt: data.paidAt ?? new Date(),
        notes: data.notes,
        createdById: userId,
      },
    });
    return recalculatePaymentStatus(tx, orderId);
  });
}

export async function getAccountsReceivable(params: { page: number; pageSize: number }) {
  const { page, pageSize } = params;
  const where: Prisma.DispatchOrderWhereInput = {
    deletedAt: null,
    paymentMethod: PaymentMethod.CREDITO,
    dueDate: { lt: new Date() },
    paymentStatus: { not: PaymentStatus.PAGADO },
  };

  const [rows, total] = await Promise.all([
    prisma.dispatchOrder.findMany({
      where,
      orderBy: { dueDate: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        wholesaler: { select: { id: true, businessName: true } },
        finalCustomer: { select: { id: true, fullName: true } },
        items: { select: { unitPrice: true, quantity: true } },
      },
    }),
    prisma.dispatchOrder.count({ where }),
  ]);

  // Igual que el detalle: orderTotal sale de computeOrderTotal, no de una
  // fórmula reimplementada acá — y los items crudos no se exponen, solo el
  // total ya calculado (el listado de cartera no necesita línea por línea).
  return {
    data: rows.map(({ items, ...order }) => ({ ...order, orderTotal: computeOrderTotal(items) })),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}
