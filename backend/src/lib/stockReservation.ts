// reservedStock representa unidades comprometidas por órdenes PENDIENTE
// (aún no despachadas). Mismo patrón atómico que applyMovement: el
// increment/decrement lo calcula Postgres en una sola sentencia (sin leer y
// luego escribir por separado), y el chequeo de invariante se hace sobre el
// valor YA actualizado que devuelve esa misma sentencia — no hay ventana de
// condición de carrera entre dos reservas simultáneas sobre la misma variante.
import { Prisma } from "@prisma/client";
import { badRequest } from "../utils/httpError";

export async function reserveStock(tx: Prisma.TransactionClient, variantId: string, quantity: number) {
  const variant = await tx.productVariant.update({
    where: { id: variantId },
    data: { reservedStock: { increment: quantity } },
  });

  if (variant.reservedStock > variant.stock) {
    const available = variant.stock - (variant.reservedStock - quantity);
    throw badRequest(
      `Stock insuficiente para la variante ${variant.sku} (disponible: ${available}, solicitado: ${quantity})`
    );
  }

  return variant;
}

export async function releaseStock(tx: Prisma.TransactionClient, variantId: string, quantity: number) {
  return tx.productVariant.update({
    where: { id: variantId },
    data: { reservedStock: { decrement: quantity } },
  });
}
