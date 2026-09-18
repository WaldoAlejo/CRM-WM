import { Role } from "@prisma/client";

// unitCost y landedCostPerUnit son dato de costo (igual que los precios de
// variante o los costos de ImportBatch): OPERATOR no los ve en ningún listado
// de movimientos, aunque sí pueda haberlos generado él mismo al recibir
// mercadería.
export function serializeMovementForRole<T extends Record<string, unknown>>(
  movement: T,
  role: Role
): T {
  if (role === Role.ADMIN) return movement;

  const sanitized = { ...movement };
  delete (sanitized as Record<string, unknown>).unitCost;
  delete (sanitized as Record<string, unknown>).landedCostPerUnit;
  return sanitized;
}
