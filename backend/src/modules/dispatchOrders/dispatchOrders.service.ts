import {
  BuyerType,
  DispatchStatus,
  LocationType,
  MovementType,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  Role,
  ShipmentStatus,
} from "@prisma/client";
import { applyMovement, computeLandedCost, computeWeightedAverageCost } from "../../lib/inventoryMovements";
import { generateConsignmentCode, generateOrderNumber } from "../../lib/orderNumber";
import { computeOrderTotal, recalculatePaymentStatus } from "../../lib/paymentRecalculation";
import { classifyReceivable, dueSoonUpperBound, type CollectionStatus } from "../../lib/receivableStatus";
import { prisma } from "../../lib/prisma";
import { reserveStock, releaseStock } from "../../lib/stockReservation";
import { negotiatedCost, negotiatedUnitPrice } from "./negotiatedPricing";
import { hasAdminAccess } from "../../lib/roles";
import { badRequest, conflict, forbidden, notFound } from "../../utils/httpError";
import { serializeDispatchOrderForRole } from "./dispatchOrders.serializer";

interface CreateOrderItemInput {
  variantId: string;
  quantity: number;
  priceType: "MAYORISTA" | "PVP";
  unitPrice?: number;
  markupPct?: number;
  expectedRealCost?: number;
  discountPct?: number;
  locationId?: string;
}

interface CreateOrderInput {
  buyerType: BuyerType;
  wholesalerId?: string;
  finalCustomerId?: string;
  shippingProvince: string;
  shippingCity: string;
  paymentMethod: PaymentMethod;
  creditDays?: number;
  reviewIntervalDays?: number;
  notes?: string;
  items: CreateOrderItemInput[];
}

export async function createDispatchOrder(data: CreateOrderInput, userId: string | undefined, role: Role) {
  if (data.paymentMethod === PaymentMethod.CONSIGNACION && !hasAdminAccess(role)) {
    throw forbidden("La consignación requiere acceso de administrador.");
  }
  if (!hasAdminAccess(role) && data.items.some(item => item.markupPct !== undefined)) {
    throw forbidden("La negociación sobre costo requiere acceso a costos.");
  }
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
  if ((data.paymentMethod === PaymentMethod.CREDITO || data.paymentMethod === PaymentMethod.CONSIGNACION) && data.buyerType === BuyerType.CLIENTE_FINAL) {
    throw badRequest("El crédito y la consignación solo están disponibles para compradores tipo MAYORISTA");
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

  const locationIds = [...new Set(data.items.map((i) => i.locationId).filter((id): id is string => !!id))];
  if (locationIds.length > 0) {
    const foundLocations = await prisma.location.findMany({
      where: { id: { in: locationIds }, isActive: true, type: LocationType.STANDARD },
      select: { id: true },
    });
    const foundLocationIds = new Set(foundLocations.map((l) => l.id));
    const missingLocationIds = locationIds.filter((id) => !foundLocationIds.has(id));
    if (missingLocationIds.length > 0) {
      throw badRequest(`Ubicaciones no encontradas: ${missingLocationIds.join(", ")}`, { field: "items" });
    }
  }

  let creditDays: number | undefined;
  if (data.paymentMethod === PaymentMethod.CREDITO || data.paymentMethod === PaymentMethod.CONSIGNACION) {
    creditDays = data.creditDays ?? wholesaler?.defaultCreditDays ?? undefined;
    if (!creditDays) {
      throw badRequest(
        "Los días de crédito son obligatorios para crédito o liquidación de consignación (el mayorista no tiene un valor por defecto)"
      );
    }
  }

  const order = await prisma.$transaction(
    async (tx) => {
      const orderNumber = await generateOrderNumber(tx);

      const pricedItems = [];
      for (const item of data.items) {
        const base = { variantId: item.variantId, quantity: item.quantity, priceType: item.priceType, locationId: item.locationId };
        if (item.markupPct !== undefined) {
          const costs = await negotiatedCost(tx, item.variantId);
          if (item.expectedRealCost !== undefined && !costs.landedCostSnapshot.equals(item.expectedRealCost)) {
            throw conflict("El costo real cambió. Actualiza el producto en el despacho y revisa la negociación.", { field: "items" });
          }
          pricedItems.push({ ...base, priceType: data.buyerType === "MAYORISTA" ? "MAYORISTA" as const : "PVP" as const,
            ...costs, markupPct: item.markupPct, unitPrice: negotiatedUnitPrice(costs.landedCostSnapshot, item.markupPct) });
        } else {
          pricedItems.push({ ...base, unitPrice: new Prisma.Decimal(item.unitPrice!), discountPct: item.discountPct });
        }
      }
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
          reviewIntervalDays: data.reviewIntervalDays ?? 20,
          notes: data.notes,
          createdById: userId,
          items: {
            create: pricedItems,
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

  if (order.paymentMethod === PaymentMethod.CONSIGNACION && !hasAdminAccess(role)) {
    throw forbidden("La consignación requiere acceso de administrador.");
  }
  const dispatchDate = new Date();
  const dueDate =
    order.paymentMethod === PaymentMethod.CREDITO && order.creditDays
      ? addDays(dispatchDate, order.creditDays)
      : null;

  const result = await prisma.$transaction(async (tx) => {
    // Reclamar la transición antes de tocar reservas evita confirmaciones/cancelaciones dobles.
    const claimed = await tx.dispatchOrder.updateMany({
      where: { id: orderId, status: DispatchStatus.PENDIENTE },
      data: { status: DispatchStatus.DESPACHADO },
    });
    if (!claimed.count) throw conflict("La orden ya no está pendiente.");
    const lot = order.paymentMethod === PaymentMethod.CONSIGNACION
      ? await tx.consignmentLot.create({ data: {
          code: await generateConsignmentCode(tx), dispatchOrderId: order.id,
          wholesalerId: order.wholesalerId!, shippingProvince: order.shippingProvince,
          shippingCity: order.shippingCity, creditDays: order.creditDays!,
          deliveredAt: dispatchDate, reviewIntervalDays: order.reviewIntervalDays,
          nextReviewDate: addDays(dispatchDate, order.reviewIntervalDays),
          notes: order.notes, createdById: userId,
        } }) : null;
    for (const item of order.items) {
      // El costo promedio ponderado y el costo de aterrizaje se calculan y se
      // congelan AHORA, en el momento exacto de confirmar — si el costo de
      // compra o el prorrateo de flete/aduana cambian después, los reportes
      // de ganancia de esta orden ya no se ven afectados. GET
      // /reports/profitability lee estos dos snapshots, nunca recalcula en
      // vivo.
      if (item.markupPct == null) {
        const [unitCostSnapshot, landedCostSnapshot] = await Promise.all([
          computeWeightedAverageCost(tx, item.variantId), computeLandedCost(tx, item.variantId),
        ]);
        await tx.dispatchOrderItem.update({ where: { id: item.id }, data: { unitCostSnapshot, landedCostSnapshot } });
      }
      // Negotiated lines keep the cost agreed when the order was created.


      await releaseStock(tx, item.variantId, item.quantity);

      const movement = await applyMovement(tx, {
        variantId: item.variantId,
        type: lot ? MovementType.CONSIGNACION : MovementType.SALIDA,
        quantity: -item.quantity,
        dispatchOrderItemId: item.id,
        locationId: item.locationId ?? undefined,
        createdById: userId,
      });
      if (lot) {
        const priced = await tx.dispatchOrderItem.findUniqueOrThrow({ where: { id: item.id } });
        await tx.consignmentLine.create({ data: {
          lotId: lot.id, variantId: item.variantId, originLocationId: item.locationId,
          quantityDelivered: item.quantity, unitPrice: item.unitPrice,
          unitCostSnapshot: priced.unitCostSnapshot, landedCostSnapshot: priced.landedCostSnapshot,
          deliveryMovementId: movement.id,
        } });
      }
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
  }, { timeout: 20000 });

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
    const claimed = await tx.dispatchOrder.updateMany({
      where: { id: orderId, status: DispatchStatus.PENDIENTE },
      data: { status: DispatchStatus.CANCELADO },
    });
    if (!claimed.count) throw conflict("La orden ya no está pendiente.");
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
      consignmentLot: { select: { id: true, code: true } },
      payments: { orderBy: { paidAt: "desc" } },
      shipment: { include: { courier: { select: { id: true, name: true } }, claim: true } },
    },
  });
  if (!order) throw notFound("Orden no encontrada");

  // orderTotal viene de la MISMA función que recalcula paymentStatus al
  // registrar un pago — el detalle nunca reimplementa la fórmula de sumar
  // ítems, solo muestra lo que ya calculó el sistema.
  const orderTotal = computeOrderTotal(order.items);
  // Semáforo de la cuenta (null si no es crédito despachado): derivado ahora.
  const collectionStatus = classifyReceivable(order);
  return serializeDispatchOrderForRole({ ...order, orderTotal, collectionStatus }, role);
}

interface AddPaymentInput {
  amount: number;
  method: string;
  paidAt?: Date;
  notes?: string;
  // Ruta relativa del comprobante ya subido al almacenamiento privado (opcional).
  proofFile?: string;
}

export async function assertOrderExists(orderId: string) {
  const order = await prisma.dispatchOrder.findFirst({ where: { id: orderId, deletedAt: null }, select: { id: true } });
  if (!order) throw notFound("Orden no encontrada");
}

export async function addPayment(orderId: string, data: AddPaymentInput, userId: string | undefined) {
  const order = await prisma.dispatchOrder.findFirst({ where: { id: orderId, deletedAt: null } });
  if (!order) throw notFound("Orden no encontrada");

  if (order.paymentMethod === PaymentMethod.CONSIGNACION) {
    throw badRequest("Registra el pago en el cargo generado al liquidar la consignación.");
  }
  return prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        dispatchOrderId: orderId,
        amount: data.amount,
        method: data.method,
        paidAt: data.paidAt ?? new Date(),
        notes: data.notes,
        proofFile: data.proofFile,
        createdById: userId,
      },
    });
    return recalculatePaymentStatus(tx, orderId);
  });
}

// Ruta en BD del comprobante de UN pago de ESTA orden (nunca de otra: el
// paymentId solo se resuelve dentro del orderId de la URL).
export async function getPaymentProofPath(orderId: string, paymentId: string): Promise<string> {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, dispatchOrderId: orderId },
    select: { proofFile: true },
  });
  if (!payment?.proofFile) throw notFound("Este pago no tiene comprobante");
  return payment.proofFile;
}

export type ReceivableFilter = CollectionStatus | "TODAS";

// `where` de cada estado: espejo EXACTO de classifyReceivable (mismos bordes,
// mismo umbral de 7 días). Ver lib/receivableStatus.ts.
function receivableWhere(filter: ReceivableFilter, now: Date): Prisma.DispatchOrderWhereInput {
  const base: Prisma.DispatchOrderWhereInput = {
    deletedAt: null,
    paymentMethod: PaymentMethod.CREDITO,
    dueDate: { not: null },
  };
  const unpaid = { paymentStatus: { not: PaymentStatus.PAGADO } };
  const soonLimit = dueSoonUpperBound(now);
  switch (filter) {
    case "VENCIDO":
      return { ...base, ...unpaid, dueDate: { lt: now } };
    case "POR_VENCER":
      return { ...base, ...unpaid, dueDate: { gte: now, lte: soonLimit } };
    case "PENDIENTE":
      return { ...base, ...unpaid, dueDate: { gt: soonLimit } };
    case "COMPLETADO":
      return { ...base, paymentStatus: PaymentStatus.PAGADO };
    case "TODAS":
      return base;
  }
}

// Por defecto (sin `status`) sigue siendo el listado de siempre: solo VENCIDAS.
// Con `status` se ve cualquier otro estado, o TODAS las cuentas a crédito con su
// semáforo (collectionStatus, derivado al consultar — nunca guardado).
export async function getAccountsReceivable(params: { page: number; pageSize: number; status?: ReceivableFilter }) {
  const { page, pageSize, status = "VENCIDO" } = params;
  const now = new Date();
  const where = receivableWhere(status, now);

  const [rows, total] = await Promise.all([
    prisma.dispatchOrder.findMany({
      where,
      orderBy: { dueDate: status === "COMPLETADO" ? "desc" : "asc" },
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
    data: rows.map(({ items, ...order }) => ({
      ...order,
      orderTotal: computeOrderTotal(items),
      collectionStatus: classifyReceivable(order, now),
    })),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export interface ReceivableBucket {
  count: number;
  outstanding: Prisma.Decimal;
}

// Versión liviana para GET /dashboard/summary. `overdueCount` y
// `totalOutstanding` siguen siendo EXACTAMENTE lo de siempre (cuentas VENCIDAS);
// `byStatus` agrega el semáforo de la cartera con saldo pendiente (vencidas, por
// vencer, pendientes) clasificando con la MISMA función que el listado y el
// detalle, y sumando con computeOrderTotal (la misma fórmula, nunca una nueva).
export async function getAccountsReceivableSummary() {
  const now = new Date();
  const rows = await prisma.dispatchOrder.findMany({
    where: {
      deletedAt: null,
      paymentMethod: PaymentMethod.CREDITO,
      dueDate: { not: null },
      paymentStatus: { not: PaymentStatus.PAGADO },
    },
    select: {
      paymentMethod: true,
      paymentStatus: true,
      dueDate: true,
      amountPaid: true,
      items: { select: { unitPrice: true, quantity: true } },
    },
  });

  const zero = () => ({ count: 0, outstanding: new Prisma.Decimal(0) });
  const byStatus: Record<"VENCIDO" | "POR_VENCER" | "PENDIENTE", ReceivableBucket> = {
    VENCIDO: zero(),
    POR_VENCER: zero(),
    PENDIENTE: zero(),
  };

  for (const order of rows) {
    const status = classifyReceivable(order, now);
    if (status !== "VENCIDO" && status !== "POR_VENCER" && status !== "PENDIENTE") continue;
    const outstanding = computeOrderTotal(order.items).minus(order.amountPaid ?? new Prisma.Decimal(0));
    byStatus[status].count += 1;
    byStatus[status].outstanding = byStatus[status].outstanding.plus(outstanding);
  }

  const round = (b: ReceivableBucket) => ({ count: b.count, outstanding: b.outstanding.toDecimalPlaces(2) });
  return {
    overdueCount: byStatus.VENCIDO.count,
    totalOutstanding: byStatus.VENCIDO.outstanding.toDecimalPlaces(2),
    byStatus: {
      VENCIDO: round(byStatus.VENCIDO),
      POR_VENCER: round(byStatus.POR_VENCER),
      PENDIENTE: round(byStatus.PENDIENTE),
    },
  };
}
