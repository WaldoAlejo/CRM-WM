import { Prisma } from "@prisma/client";

// Autogenera "OD-000123" a partir de OrderNumberCounter (fila única, id=1),
// incrementada con un UPDATE...RETURNING atómico. Reemplaza el conteo de
// filas anterior (dispatchOrder.count() + 1), que SÍ colisionaba bajo
// concurrencia real (confirmado por un test de 10 creaciones simultáneas:
// varias calculaban el mismo "count+1" y competían por el mismo
// orderNumber, generando 409 de UNIQUE en vez de servirse todas).
//
// El UPDATE toma un lock de fila sobre OrderNumberCounter que dura hasta que
// ESTA transacción (tx) hace commit o rollback — cualquier otra llamada
// concurrente a generateOrderNumber queda bloqueada en este mismo UPDATE
// hasta entonces, nunca calcula un número ya tomado. Debe llamarse SIEMPRE
// dentro de la misma transacción que crea la orden (nunca con `prisma`
// directo): si la orden falla después, el rollback también libera el lock
// sin haber persistido el número.
//
// Sin riesgo de deadlock: los dos callers (createDispatchOrder e
// insuranceClaims.resolveCustomer) toman este lock SIEMPRE primero, y recién
// después el de ProductVariant (vía reserveStock) — mismo orden de
// adquisición en los dos casos, nunca al revés, así que nunca hay espera
// circular entre dos transacciones.
//
// A propósito NO es $queryRaw: un UPDATE crudo depende del search_path de la
// sesión para resolver "OrderNumberCounter" sin schema explícito, y bajo el
// pooler de Neon (pgbouncer) esa sesión puede no ser la que uno espera —
// exactamente el incidente real ya documentado en tests/helpers.ts (un
// current_schema() crudo terminó operando sobre "public" en vez de
// "test_integration"). Las queries TIPADAS de Prisma no tienen ese problema:
// van con el nombre del schema ya resuelto en el SQL que generan. `update`
// con `increment` compila a un único UPDATE...RETURNING atómico (no hace un
// SELECT y después un UPDATE separado), así que la garantía de lock es
// idéntica a la del SQL crudo, sin el riesgo del search_path.
export async function generateOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const counter = await tx.orderNumberCounter.update({
    where: { id: 1 },
    data: { lastNumber: { increment: 1 } },
  });
  return `OD-${String(counter.lastNumber).padStart(6, "0")}`;
}
