import { MovementType, Prisma } from "@prisma/client";

type BatchCosts = {
  id: string;
  containerCbm: Prisma.Decimal | null;
  freightCost: Prisma.Decimal | null;
  customsCost: Prisma.Decimal | null;
  otherCosts: Prisma.Decimal | null;
};

// Reparto de gastos del lote en landedCostPerUnit:
// - Flete y otros gastos: por volumen, tarifa = (flete + otros) / CBM contratados.
// - Aduana: por valor, en proporción al FOB (cantidad × costo unitario) de cada
//   línea sobre el FOB de todas las líneas recibidas del lote, porque los
//   aranceles se cobran sobre el valor y no sobre el espacio.
// Como el FOB total solo se conoce al terminar de recibir, cada recepción
// recalcula TODOS los ingresos del lote. Los despachos ya confirmados no cambian:
// guardan su costo en DispatchOrderItem.landedCostSnapshot.
export async function reallocateBatchLandedCosts(tx: Prisma.TransactionClient, batch: BatchCosts) {
  if (!batch.containerCbm || new Prisma.Decimal(batch.containerCbm).lessThanOrEqualTo(0)) return;
  const containerCbm = new Prisma.Decimal(batch.containerCbm);
  const customs = new Prisma.Decimal(batch.customsCost ?? 0);
  const volumeCosts = new Prisma.Decimal(batch.freightCost ?? 0).plus(batch.otherCosts ?? 0);

  const rows = await tx.inventoryMovement.findMany({
    where: { importBatchId: batch.id, type: MovementType.INGRESO },
    select: { id: true, quantity: true, unitCost: true, volumeCbm: true },
  });
  const fob = (row: (typeof rows)[number]) => new Prisma.Decimal(row.unitCost ?? 0).times(row.quantity);
  const totalFob = rows.reduce((sum, row) => sum.plus(fob(row)), new Prisma.Decimal(0));
  // Sin valor FOB (costos en 0) la aduana vuelve a repartirse por volumen.
  const volumeRate = (totalFob.greaterThan(0) ? volumeCosts : volumeCosts.plus(customs)).dividedBy(containerCbm);

  for (const row of rows) {
    if (row.quantity <= 0) continue;
    const lineCost = volumeRate.times(row.volumeCbm ?? 0)
      .plus(totalFob.greaterThan(0) ? customs.times(fob(row)).dividedBy(totalFob) : 0);
    await tx.inventoryMovement.update({
      where: { id: row.id },
      data: { landedCostPerUnit: lineCost.dividedBy(row.quantity).toDecimalPlaces(6) },
    });
  }
}
