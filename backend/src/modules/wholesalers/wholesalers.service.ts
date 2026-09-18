import { DispatchStatus, PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { conflict, notFound } from "../../utils/httpError";
import { rucValidationService } from "./ruc-validation";

const { Decimal } = Prisma;

export async function validateRuc(ruc: string) {
  // Nunca lanza: el adaptador ya atrapa sus propios errores, pero esta capa
  // es la que decide qué le llega al controller.
  return rucValidationService.validate(ruc);
}

export async function listWholesalers() {
  return prisma.wholesaler.findMany({
    where: { deletedAt: null },
    orderBy: { businessName: "asc" },
  });
}

interface CreateWholesalerInput {
  businessName: string;
  ruc: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  creditLimit?: number;
  defaultCreditDays?: number;
}

export async function createWholesaler(data: CreateWholesalerInput) {
  // La validación de RUC es solo informativa/de auditoría: si falla o el
  // proveedor no responde, se crea el mayorista igual con los datos
  // cargados a mano (nunca se bloquea el registro por esto).
  const validation = await validateRuc(data.ruc);

  return prisma.wholesaler.create({
    data: {
      ...data,
      rucValidationStatus: validation.found ? validation.taxStatus ?? null : null,
      rucValidationResponse: validation.raw ? (validation.raw as object) : undefined,
      rucValidatedAt: validation.found ? new Date() : null,
    },
  });
}

export async function getWholesalerById(id: string) {
  const wholesaler = await prisma.wholesaler.findFirst({ where: { id, deletedAt: null } });
  if (!wholesaler) throw notFound("Mayorista no encontrado");
  return wholesaler;
}

interface UpdateWholesalerInput {
  businessName?: string;
  ruc?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  creditLimit?: number;
  defaultCreditDays?: number;
}

export async function updateWholesaler(id: string, data: UpdateWholesalerInput) {
  await getWholesalerById(id); // valida que exista y no esté eliminado

  // A diferencia de crear, actualizar NO vuelve a consultar el RUC contra el
  // proveedor externo: si el usuario solo corrige el teléfono o el nombre de
  // contacto, no hay razón para gastar una consulta externa ni para pisar
  // rucValidationStatus/rucValidatedAt con un resultado de una llamada que
  // nadie pidió. Si en el futuro se quiere revalidar el RUC al cambiarlo,
  // es una decisión de producto aparte, no un efecto secundario implícito.
  return prisma.wholesaler.update({ where: { id }, data });
}

// Bloquea el soft delete por 2 motivos independientes (se muestran los que
// apliquen, no solo el primero):
// 1. Despachos PENDIENTES: la orden todavía necesita al mayorista para
//    completarse (chequeo de crédito al confirmar, etc.) — mismo criterio
//    que Category/Brand con productos activos, aplicado a "trabajo en
//    curso" en vez de "catálogo".
// 2. Cuentas por cobrar activas: órdenes ya DESPACHADO, a CRÉDITO, con saldo
//    pendiente (PENDIENTE o PARCIAL) — no historial cerrado, es deuda real
//    que alguien tiene que seguir cobrando.
// Órdenes DESPACHADO/CANCELADO ya saldadas (o de CONTADO/CONTRA_ENTREGA) son
// historial inmutable, igual que ImportBatch para Supplier: no bloquean nada.
export async function softDeleteWholesaler(id: string) {
  const wholesaler = await getWholesalerById(id);

  const reasons: string[] = [];

  const pendingDispatchCount = await prisma.dispatchOrder.count({
    where: { wholesalerId: id, deletedAt: null, status: DispatchStatus.PENDIENTE },
  });
  if (pendingDispatchCount > 0) {
    reasons.push(
      `No se puede eliminar: hay ${pendingDispatchCount} orden(es) pendiente(s) de despacho para este mayorista. Despáchalas o cancélalas primero.`
    );
  }

  const creditOrders = await prisma.dispatchOrder.findMany({
    where: {
      wholesalerId: id,
      deletedAt: null,
      status: DispatchStatus.DESPACHADO,
      paymentMethod: PaymentMethod.CREDITO,
      paymentStatus: { in: [PaymentStatus.PENDIENTE, PaymentStatus.PARCIAL] },
    },
    include: { items: { select: { unitPrice: true, quantity: true } } },
  });

  const totalDebt = creditOrders.reduce((sum, order) => {
    const orderTotal = order.items.reduce(
      (itemSum, item) => itemSum.plus(item.unitPrice.times(item.quantity)),
      new Decimal(0)
    );
    return sum.plus(orderTotal.minus(order.amountPaid ?? new Decimal(0)));
  }, new Decimal(0));

  if (totalDebt.greaterThan(0)) {
    reasons.push(
      `No se puede eliminar: este mayorista tiene $${totalDebt.toDecimalPlaces(2)} en cuentas por cobrar pendientes. Registra el pago o el reembolso antes de eliminarlo.`
    );
  }

  if (reasons.length > 0) {
    throw conflict(reasons.join(" "), { reasons });
  }

  return prisma.wholesaler.update({ where: { id: wholesaler.id }, data: { deletedAt: new Date() } });
}
