// Única función que puede escribir en InventoryMovement / mover `stock`.
// La usan Ingresos, Ajustes, y (más adelante) Despachos para SALIDA — todos
// comparten exactamente la misma garantía de atomicidad, nunca una versión
// distinta de esta lógica por módulo.
import { InventoryMovement, MovementType, Prisma } from "@prisma/client";
import { badRequest } from "../utils/httpError";

export interface ApplyMovementInput {
  variantId: string;
  type: MovementType;
  quantity: number; // con signo: + suma stock, - resta. Nunca 0.
  // NO se valida obligatoriedad de `reason` acá — es responsabilidad del
  // schema Zod del endpoint que llama (hoy: AJUSTE en /inventory/adjustments).
  reason?: string;
  notes?: string;
  unitCost?: number;
  landedCostPerUnit?: number;
  volumeCbm?: number;
  importBatchId?: string;
  dispatchOrderItemId?: string;
  createdById?: string;
  // Ubicación única del lado que le corresponde a este movimiento — el
  // llamante nunca tiene que decidir si es origen o destino, lo decide el
  // signo de `quantity` acá abajo (mismo criterio que decide sumar/restar
  // stock). Ver el comentario de fromLocationId/toLocationId en schema.prisma.
  locationId?: string;
}

export async function applyMovement(
  tx: Prisma.TransactionClient,
  input: ApplyMovementInput
): Promise<InventoryMovement> {
  if (input.quantity === 0) {
    throw badRequest("La cantidad de un movimiento no puede ser 0.");
  }

  // Postgres calcula stock + quantity de forma atómica en una sola sentencia
  // (UPDATE ... SET stock = stock + $1 RETURNING stock): no hay ventana entre
  // leer y escribir donde otro movimiento simultáneo pueda meterse. Si
  // variantId no existe, esto tira P2025 (el errorHandler ya lo mapea a 404)
  // y la transacción entera revierte.
  const variant = await tx.productVariant.update({
    where: { id: input.variantId },
    data: { stock: { increment: input.quantity } },
  });

  // Universal para los 5 tipos de movimiento (no solo AJUSTE): así el futuro
  // módulo de Despachos hereda esta protección sin tener que repetirla.
  if (variant.stock < 0) {
    throw badRequest(
      `El movimiento dejaría el stock en negativo (stock resultante: ${variant.stock}).`
    );
  }

  return tx.inventoryMovement.create({
    data: {
      variantId: input.variantId,
      type: input.type,
      quantity: input.quantity,
      stockAfter: variant.stock,
      reason: input.reason,
      notes: input.notes,
      unitCost: input.unitCost,
      landedCostPerUnit: input.landedCostPerUnit,
      volumeCbm: input.volumeCbm,
      importBatchId: input.importBatchId,
      dispatchOrderItemId: input.dispatchOrderItemId,
      createdById: input.createdById,
      toLocationId: input.quantity > 0 ? input.locationId : undefined,
      fromLocationId: input.quantity < 0 ? input.locationId : undefined,
    },
  });
}

// Costo promedio ponderado de una variante: promedio de TODOS los
// InventoryMovement de tipo INGRESO históricos (no solo los que "todavía
// tienen stock disponible" — sería un cálculo tipo FIFO, más pesado y no es
// lo que pediste). Misma fórmula que ya usa prisma/seed.ts, ahora compartida
// para que /dispatch-orders/:id/confirm no reimplemente su propia versión.
export async function computeWeightedAverageCost(
  tx: Prisma.TransactionClient,
  variantId: string
): Promise<number> {
  const ingresos = await tx.inventoryMovement.findMany({
    where: { variantId, type: MovementType.INGRESO, unitCost: { not: null } },
    select: { quantity: true, unitCost: true },
  });

  const totalUnidades = ingresos.reduce((sum, m) => sum + m.quantity, 0);
  const totalCosto = ingresos.reduce((sum, m) => sum + Number(m.unitCost) * m.quantity, 0);

  return totalUnidades > 0 ? totalCosto / totalUnidades : 0;
}

// Costo de aterrizaje promedio ponderado: mismo patrón y mismo universo de
// INGRESO históricos que computeWeightedAverageCost, pero sumando también
// landedCostPerUnit (flete/aduana/otros prorrateados) a cada ingreso antes de
// promediar. Se llama UNA SOLA VEZ al confirmar una orden (junto a
// computeWeightedAverageCost) y su resultado se congela en
// DispatchOrderItem.landedCostSnapshot — nunca se vuelve a llamar en vivo
// desde un reporte, porque el promedio ponderado se sigue moviendo con cada
// INGRESO nuevo y eso rompería la reproducibilidad de reportes históricos.
export async function computeLandedCost(
  tx: Prisma.TransactionClient,
  variantId: string
): Promise<number> {
  const ingresos = await tx.inventoryMovement.findMany({
    where: { variantId, type: MovementType.INGRESO, unitCost: { not: null } },
    select: { quantity: true, unitCost: true, landedCostPerUnit: true },
  });

  const totalUnidades = ingresos.reduce((sum, m) => sum + m.quantity, 0);
  const totalCosto = ingresos.reduce(
    (sum, m) => sum + (Number(m.unitCost) + Number(m.landedCostPerUnit ?? 0)) * m.quantity,
    0
  );

  return totalUnidades > 0 ? totalCosto / totalUnidades : 0;
}
