import type { DispatchOrderItemFormValues } from "./dispatchOrders.schema";

// Descuento sobre el precio de lista (mayorista o PVP) en las líneas con negociación.
// El precio de la fila sigue siendo la única fuente de verdad: el descuento se
// deduce de él para mostrarlo, y escribir un descuento solo vuelve a escribir el precio.

// toPrecision quita el ruido binario antes de redondear: 73,50 × 1,15 = 84,525 → 84,53 (no 84,52).
const round2 = (n: number) => Math.round(Number((n * 100).toPrecision(12))) / 100;

type PricedItem = Pick<DispatchOrderItemFormValues, "priceType" | "listWholesaleAtAdd" | "listRetailAtAdd" | "ivaRateAtAdd">;

export function ivaFactor(item: Pick<DispatchOrderItemFormValues, "ivaRateAtAdd">, includeIva: boolean): number {
  return includeIva ? 1 + (item.ivaRateAtAdd ?? 0) / 100 : 1;
}

// Precio de lista sin IVA según la base elegida en "Tipo" (MAYORISTA o PVP).
export function listPrice(item: PricedItem): number | undefined {
  const price = item.priceType === "MAYORISTA" ? item.listWholesaleAtAdd : item.listRetailAtAdd;
  return price && price > 0 ? price : undefined;
}

// Precio de la fila (con IVA si la casilla está marcada) para un descuento sobre la lista.
export function priceFromListDiscount(item: PricedItem, discountPct: number, includeIva: boolean): number | undefined {
  const list = listPrice(item);
  if (list === undefined) return undefined;
  return round2(list * ivaFactor(item, includeIva) * (1 - (Number.isFinite(discountPct) ? discountPct : 0) / 100));
}

// Campos de la fila para un descuento sobre la lista: el precio queda escrito y el
// incremento sobre el costo se deduce de él (mismo cálculo que el servidor).
// Sin precio de lista para la base elegida devuelve undefined y la fila no cambia.
export function applyListDiscount(
  item: PricedItem & Pick<DispatchOrderItemFormValues, "costAtAdd">, discountPct: number, includeIva: boolean
): { unitPrice: number; priceTyped: true; markupPct: number | undefined } | undefined {
  const unitPrice = priceFromListDiscount(item, discountPct, includeIva);
  if (unitPrice === undefined) return undefined;
  const cost = item.costAtAdd ?? 0;
  const net = round2(unitPrice / ivaFactor(item, includeIva));
  return { unitPrice, priceTyped: true, markupPct: cost > 0 ? round2((net / cost - 1) * 100) : undefined };
}

// Descuento que representa un precio sin IVA frente a la lista (negativo = sobre la lista).
export function listDiscountFromNet(item: PricedItem, netPrice: number): number | undefined {
  const list = listPrice(item);
  if (list === undefined) return undefined;
  return round2((1 - netPrice / list) * 100);
}
