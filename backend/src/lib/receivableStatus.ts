// Semaforización de cuentas por cobrar. UNA sola definición, compartida por el
// listado de Cuentas por Cobrar, el detalle de la orden, el resumen del
// Dashboard y el job de recordatorios (que usa el mismo umbral de 7 días):
// ninguno debe reimplementar estas reglas.
//
// El estado se DERIVA en el momento de consultar (paymentStatus + dueDate vs.
// ahora); nunca se guarda — mismo criterio que "revisión vencida" en
// Consignación, así no hay cron que lo actualice ni valor que se desfase.
import { DispatchStatus, PaymentMethod, PaymentStatus } from "@prisma/client";

// Días previos al vencimiento en los que una cuenta pasa a "por vencer".
export const DUE_SOON_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CollectionStatus = "COMPLETADO" | "PENDIENTE" | "POR_VENCER" | "VENCIDO";

// Límite superior (inclusivo) de la ventana "por vencer".
export function dueSoonUpperBound(now: Date): Date {
  return new Date(now.getTime() + DUE_SOON_WINDOW_DAYS * DAY_MS);
}

interface ClassifiableOrder {
  paymentMethod: PaymentMethod;
  status?: DispatchStatus;
  paymentStatus: PaymentStatus;
  dueDate: Date | null;
}

// Reglas (en este orden):
// - Solo aplica a cuentas CREDITO ya despachadas (con dueDate). Cualquier otra
//   orden (contado, contra entrega, aún pendiente, cancelada) → null.
// - Saldo pagado por completo → COMPLETADO (verde), sin importar la fecha.
// - Con saldo pendiente:
//     dueDate < ahora                     → VENCIDO    (rojo) — aunque tenga abonos
//     ahora <= dueDate <= ahora + 7 días  → POR_VENCER (ámbar): incluye EXACTAMENTE
//                                           el día del vencimiento y EXACTAMENTE 7 días
//     dueDate > ahora + 7 días            → PENDIENTE  (gris/azul neutro)
export function classifyReceivable(order: ClassifiableOrder, now: Date = new Date()): CollectionStatus | null {
  if (order.paymentMethod !== PaymentMethod.CREDITO) return null;
  if (order.status !== undefined && order.status !== DispatchStatus.DESPACHADO) return null;
  if (!order.dueDate) return null;

  if (order.paymentStatus === PaymentStatus.PAGADO) return "COMPLETADO";
  if (order.dueDate.getTime() < now.getTime()) return "VENCIDO";
  if (order.dueDate.getTime() <= dueSoonUpperBound(now).getTime()) return "POR_VENCER";
  return "PENDIENTE";
}
