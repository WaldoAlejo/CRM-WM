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

export function serializeDispatchOrderForRole<T extends { items?: Record<string, unknown>[] }>(
  order: T,
  role: Role
): T {
  if (!order.items) return order;
  return { ...order, items: order.items.map((item) => serializeItemForRole(item, role)) };
}
