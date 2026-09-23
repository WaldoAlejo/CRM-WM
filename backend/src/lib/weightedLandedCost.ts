import { Prisma } from '@prisma/client';

export interface CostReceipt {
  quantity: number;
  unitCost: Prisma.Decimal | null;
  landedCostPerUnit: Prisma.Decimal | null;
}

/** Same historical receipt basis as negotiated pricing; never use the factory reference field. */
export function weightedLandedCost(rows: CostReceipt[]): Prisma.Decimal | null {
  let quantity = 0;
  let total = new Prisma.Decimal(0);
  for (const row of rows) {
    if (row.unitCost === null) continue;
    quantity += row.quantity;
    total = total.plus(row.unitCost.plus(row.landedCostPerUnit ?? 0).times(row.quantity));
  }
  return quantity > 0 ? total.div(quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : null;
}

export async function catalogWeightedCosts(db: Prisma.TransactionClient, productIds: string[]) {
  const products = new Map<string, string>();
  const variants = new Map<string, string>();
  if (!productIds.length) return { products, variants };
  const rows = await db.inventoryMovement.findMany({
    where: { type: 'INGRESO', unitCost: { not: null }, variant: { productId: { in: productIds }, deletedAt: null } },
    select: { variantId: true, quantity: true, unitCost: true, landedCostPerUnit: true, variant: { select: { productId: true } } },
  });
  const productRows = new Map<string, CostReceipt[]>();
  const variantRows = new Map<string, CostReceipt[]>();
  for (const row of rows) {
    const p = productRows.get(row.variant.productId) ?? [];
    p.push(row); productRows.set(row.variant.productId, p);
    const v = variantRows.get(row.variantId) ?? [];
    v.push(row); variantRows.set(row.variantId, v);
  }
  for (const [id, receipts] of productRows) { const cost = weightedLandedCost(receipts); if (cost !== null) products.set(id, cost.toFixed(2)); }
  for (const [id, receipts] of variantRows) { const cost = weightedLandedCost(receipts); if (cost !== null) variants.set(id, cost.toFixed(2)); }
  return { products, variants };
}
