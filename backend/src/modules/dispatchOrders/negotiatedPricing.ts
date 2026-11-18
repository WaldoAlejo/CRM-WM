import { Prisma } from "@prisma/client";
import { badRequest } from "../../utils/httpError";
import { weightedLandedCost } from '../../lib/weightedLandedCost';

export async function negotiatedCost(tx: Prisma.TransactionClient, variantId: string) {
  const rows = await tx.inventoryMovement.findMany({
    where: { variantId, type: "INGRESO", unitCost: { not: null } },
    select: { quantity: true, unitCost: true, landedCostPerUnit: true },
  });
  const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  if (quantity <= 0) throw badRequest("El producto no tiene una recepción con costo real registrado.");
  const factory = rows.reduce((sum, row) => sum.plus(row.unitCost!.times(row.quantity)), new Prisma.Decimal(0));
  const landedCostSnapshot = weightedLandedCost(rows)!;
  if (!landedCostSnapshot.greaterThan(0)) throw badRequest("El costo real debe ser mayor a cero para negociar un incremento.");
  return { landedCostSnapshot, unitCostSnapshot: factory.div(quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) };
}

// Precio escrito a mano en una línea con incremento sobre costo: se guarda tal
// cual y el incremento se deduce del costo real (no al revés), para que el total
// cobrado coincida exactamente con lo acordado con el cliente.
export function markupFromPrice(cost: Prisma.Decimal, unitPrice: Prisma.Decimal) {
  const markup = unitPrice.div(cost).minus(1).times(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (markup.isNegative()) throw badRequest("El precio queda por debajo del costo real del producto.", { field: "items" });
  if (markup.greaterThan(10000)) throw badRequest("El incremento sobre el costo supera el máximo permitido.", { field: "items" });
  return markup;
}

// Quita el IVA de un precio escrito con IVA incluido (redondeo a centavos).
export function priceWithoutIva(price: Prisma.Decimal, ivaRate: Prisma.Decimal | undefined) {
  if (!ivaRate || ivaRate.isZero()) return price;
  return price.div(ivaRate.div(100).plus(1)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function negotiatedUnitPrice(cost: Prisma.Decimal, markupPct: number) {
  const price = cost.times(new Prisma.Decimal(markupPct).div(100).plus(1)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (price.greaterThan("99999999.99")) throw badRequest("El precio negociado supera el máximo permitido.");
  return price;
}
