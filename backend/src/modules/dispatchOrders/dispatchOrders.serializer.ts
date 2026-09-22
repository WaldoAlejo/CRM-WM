import { Role } from "@prisma/client";
import { hasAdminAccess } from "../../lib/roles";

// unitCostSnapshot y landedCostSnapshot son costo (feeds los reportes de
// ganancia): se ocultan para OPERATOR igual que unitCost en movimientos.
// unitPrice/discountPct SÍ se muestran siempre — son el precio de venta, no
// el costo, y quien despacha necesita verlos para imprimir la orden.
function serializeItemForRole<T extends Record<string, unknown>>(item: T, role: Role): T {
  if (hasAdminAccess(role)) return item;
  const sanitized = { ...item };
  delete (sanitized as Record<string, unknown>).unitCostSnapshot;
  delete (sanitized as Record<string, unknown>).landedCostSnapshot;
  return sanitized;
}

// La ruta interna del comprobante (proofFile) NUNCA sale por la API. ADMIN/CEO
// solo reciben `hasProof` (para mostrar el botón); OPERATOR no recibe ni eso:
// la foto puede mostrar datos bancarios del mayorista y no la necesita.
function serializePaymentForRole<T extends Record<string, unknown>>(payment: T, role: Role) {
  const { proofFile, ...rest } = payment;
  return hasAdminAccess(role) ? { ...rest, hasProof: Boolean(proofFile) } : rest;
}

export function serializeDispatchOrderForRole<T extends { items?: Record<string, unknown>[]; payments?: Record<string, unknown>[] }>(
  order: T,
  role: Role
): T {
  const payments = order.payments?.map((p) => serializePaymentForRole(p, role));
  const items = order.items?.map((item) => serializeItemForRole(item, role));
  if (!items && !payments) return order;
  return { ...order, ...(items && { items }), ...(payments && { payments }) };
}
