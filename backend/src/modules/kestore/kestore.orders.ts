import { createHash } from "crypto";
import { BuyerType, DispatchStatus, PaymentMethod, Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { conflict, HttpError, notFound } from "../../utils/httpError";
import { cancelDispatchOrder, createDispatchOrder } from "../dispatchOrders/dispatchOrders.service";
import { kestoreState } from "./kestore.catalog";

export const kestoreOrderSchema = z.object({
  pedido: z.string().trim().min(1).max(60),
  items: z.array(z.object({
    codigo: z.string().trim().min(1).max(50),
    cantidad: z.number().int().positive().max(10000),
  })).min(1).max(100),
  envio: z.object({
    provincia: z.string().trim().min(1).max(100),
    ciudad: z.string().trim().min(1).max(100),
    direccion: z.string().trim().max(500).optional(),
  }),
  cliente: z.object({
    nombre: z.string().trim().max(200).optional(),
    identificacion: z.string().trim().max(20).optional(),
    telefono: z.string().trim().max(50).optional(),
    email: z.string().trim().max(200).optional(),
  }).optional(),
  notas: z.string().trim().max(1000).optional(),
});

type KestoreOrderInput = z.infer<typeof kestoreOrderSchema>;

const DEFAULT_CREDIT_DAYS = 30;
const unavailable = (message: string) => new HttpError(503, message);

function statusOf(order: { status: DispatchStatus; dispatchDate: Date | null; orderNumber: string }, cancelledAt: Date | null) {
  return { ordenCrm: order.orderNumber, estado: cancelledAt ? DispatchStatus.CANCELADO : order.status, fechaDespacho: order.dispatchDate };
}

async function kestoreWholesaler() {
  const ruc = process.env.KESTORE_WHOLESALER_RUC?.trim();
  if (!ruc) throw unavailable("La recepción de pedidos de Kestore no está configurada (falta KESTORE_WHOLESALER_RUC).");
  const wholesaler = await prisma.wholesaler.findFirst({ where: { ruc, deletedAt: null, isActive: true } });
  if (!wholesaler) throw unavailable(`No existe un mayorista activo con RUC ${ruc} para registrar los pedidos de Kestore.`);
  return wholesaler;
}

function notesFor(input: KestoreOrderInput) {
  const customer = input.cliente;
  return [
    `Pedido Kestore ${input.pedido}`,
    customer?.nombre && `Cliente: ${customer.nombre}`,
    customer?.identificacion && `Identificación: ${customer.identificacion}`,
    customer?.telefono && `Teléfono: ${customer.telefono}`,
    customer?.email && `Correo: ${customer.email}`,
    input.envio.direccion && `Dirección: ${input.envio.direccion}`,
    input.notas && `Notas: ${input.notas}`,
  ].filter(Boolean).join("\n");
}

// Un pedido pagado en Kestore se registra como despacho PENDIENTE al mayorista
// Kestore, a precio mayorista: reserva el stock (Kestore recibe el nuevo
// disponible en el siguiente envío) y la cuenta por cobrar nace cuando WM
// confirma la entrega en el CRM.
export async function receiveKestoreOrder(rawBody: Buffer, input: KestoreOrderInput) {
  const requestHash = createHash("sha256").update(rawBody).digest("hex");
  const existing = await prisma.kestoreOrder.findUnique({ where: { orderNumber: input.pedido }, include: { dispatchOrder: true } });
  if (existing) {
    if (existing.requestHash !== requestHash) throw conflict(`El pedido ${input.pedido} ya se registró con otro contenido.`);
    return { created: false, body: { ok: true, pedido: input.pedido, ...statusOf(existing.dispatchOrder, existing.cancelledAt) } };
  }

  const wholesaler = await kestoreWholesaler();
  const codes = input.items.map((item) => item.codigo);
  if (new Set(codes).size !== codes.length) throw new HttpError(400, "Hay códigos repetidos en el pedido: combina las cantidades en una sola línea.");
  const variants = await prisma.productVariant.findMany({
    where: { kestoreCode: { in: codes } },
    include: { product: true },
  });
  const byCode = new Map(variants.map((v) => [v.kestoreCode!, v]));
  const problems = input.items.flatMap((item) => {
    const variant = byCode.get(item.codigo);
    if (!variant) return [{ codigo: item.codigo, motivo: "NO_EXISTE" }];
    const state = kestoreState(variant);
    if (!state.active) return [{ codigo: item.codigo, motivo: "NO_PUBLICADO" }];
    if (state.stock < item.cantidad) return [{ codigo: item.codigo, motivo: "STOCK_INSUFICIENTE", disponible: state.stock }];
    return [];
  });
  if (problems.length) throw conflict("No se puede registrar el pedido.", { items: problems });

  let dispatch;
  try {
    dispatch = await createDispatchOrder({
      buyerType: BuyerType.MAYORISTA,
      wholesalerId: wholesaler.id,
      shippingProvince: input.envio.provincia,
      shippingCity: input.envio.ciudad,
      paymentMethod: PaymentMethod.CREDITO,
      creditDays: wholesaler.defaultCreditDays ?? DEFAULT_CREDIT_DAYS,
      notes: notesFor(input),
      items: input.items.map((item) => {
        const variant = byCode.get(item.codigo)!;
        return { variantId: variant.id, quantity: item.cantidad, priceType: "MAYORISTA" as const, unitPrice: variant.wholesalePrice!.toNumber() };
      }),
    }, undefined, Role.ADMIN);
  } catch (error) {
    // Otro pedido se llevó el stock entre la validación y la reserva.
    if (error instanceof HttpError && error.statusCode === 400 && error.message.startsWith("Stock insuficiente")) {
      throw conflict("No se puede registrar el pedido.", { items: [{ motivo: "STOCK_INSUFICIENTE", detalle: error.message }] });
    }
    throw error;
  }

  try {
    await prisma.kestoreOrder.create({ data: { orderNumber: input.pedido, requestHash, dispatchOrderId: dispatch.id } });
  } catch (error) {
    // Dos envíos simultáneos del mismo pedido: gana el primero y este
    // despacho duplicado se cancela para liberar su reserva.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      await cancelDispatchOrder(dispatch.id, Role.ADMIN);
      return receiveKestoreOrder(rawBody, input);
    }
    throw error;
  }
  return { created: true, body: { ok: true, pedido: input.pedido, ordenCrm: dispatch.orderNumber, estado: dispatch.status, fechaDespacho: null } };
}

async function findKestoreOrder(orderNumber: string) {
  const order = await prisma.kestoreOrder.findUnique({ where: { orderNumber }, include: { dispatchOrder: true } });
  if (!order) throw notFound(`No existe el pedido ${orderNumber} en el CRM.`);
  return order;
}

export async function getKestoreOrder(orderNumber: string) {
  const order = await findKestoreOrder(orderNumber);
  return { ok: true, pedido: orderNumber, ...statusOf(order.dispatchOrder, order.cancelledAt) };
}

// Solo se anula lo que WM todavía no entregó; un pedido ya despachado vuelve
// por el flujo de devoluciones del CRM.
export async function cancelKestoreOrder(orderNumber: string) {
  const order = await findKestoreOrder(orderNumber);
  if (!order.cancelledAt) {
    if (order.dispatchOrder.status !== DispatchStatus.PENDIENTE && order.dispatchOrder.status !== DispatchStatus.CANCELADO) {
      throw conflict(`El pedido ${orderNumber} ya fue despachado por WM (${order.dispatchOrder.orderNumber}); la devolución se gestiona en el CRM.`);
    }
    if (order.dispatchOrder.status === DispatchStatus.PENDIENTE) await cancelDispatchOrder(order.dispatchOrderId, Role.ADMIN);
    await prisma.kestoreOrder.update({ where: { id: order.id }, data: { cancelledAt: new Date() } });
  }
  return getKestoreOrder(orderNumber);
}
