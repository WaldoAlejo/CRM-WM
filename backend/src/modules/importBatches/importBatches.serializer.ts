import { Role } from "@prisma/client";

// Mismos 3 campos que forbidFieldsForRole restringe en la escritura (ver
// importBatches.routes.ts) — un solo lugar que dice "esto es costo, no lo ve
// OPERATOR", igual que PRICING_FIELDS para variantes.
export const IMPORT_BATCH_COST_FIELDS = ["freightCost", "customsCost", "otherCosts"] as const;

export function serializeImportBatchForRole<T extends Record<string, unknown>>(
  batch: T,
  role: Role
): T {
  if (role === Role.ADMIN) return batch;

  const sanitized = { ...batch };
  for (const field of IMPORT_BATCH_COST_FIELDS) {
    delete (sanitized as Record<string, unknown>)[field];
  }
  return sanitized;
}
