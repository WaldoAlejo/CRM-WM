// Calculadora de precios (costo aterrizado → PVP → margen). Pura: solo lee un
// costo aterrizado y un PVP que ya existen (o el usuario está por decidir) y
// opera con ellos en memoria — no persiste nada, no llama a la API. Mismo
// estilo que features/importBatches/landedCost.ts (funciones puras + su
// propio round2), del que además reutiliza `landedUnitCost` para no
// reimplementar esa suma.
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// PVP sugerido = costo aterrizado × (1 + markup%/100).
// Ej: costo $19.50, markup 280% → 19.50 × 3.8 = $74.10.
export function suggestedRetailPrice(landedCost: number, markupPct: number): number {
  return round2(landedCost * (1 + markupPct / 100));
}

// Venta a cliente final: ganancia unitaria = PVP − costo aterrizado.
export function retailProfit(retailPrice: number, landedCost: number): number {
  return round2(retailPrice - landedCost);
}

// Venta a mayorista: mismo % de descuento que ya se usa por línea de
// despacho (DispatchOrderItem.discountPct) — no es un modelo nuevo, solo se
// simula acá antes de armar la orden real.
export function wholesaleUnitPrice(retailPrice: number, discountPct: number): number {
  return round2(retailPrice * (1 - discountPct / 100));
}

export function wholesaleUnitProfit(wholesaleUnitPriceValue: number, landedCost: number): number {
  return round2(wholesaleUnitPriceValue - landedCost);
}

export interface WholesaleTotals {
  totalCharge: number; // lo que se le cobra al mayorista por toda la cantidad
  totalCost: number; // costo aterrizado de esas mismas unidades
  totalProfit: number; // totalCharge − totalCost
}

export function wholesaleTotals(wholesaleUnitPriceValue: number, landedCost: number, quantity: number): WholesaleTotals {
  const totalCharge = round2(wholesaleUnitPriceValue * quantity);
  const totalCost = round2(landedCost * quantity);
  return { totalCharge, totalCost, totalProfit: round2(totalCharge - totalCost) };
}

// Markup% que, aplicado al costo aterrizado, reproduce (aprox.) un PVP ya
// existente — para prellenar el input de markup cuando se abre la
// calculadora de un producto que ya tiene precio de lista. Es solo un punto
// de partida editable, no una vuelta exacta (se redondea a 2 decimales).
export function impliedMarkupPct(retailPrice: number, landedCost: number): number | null {
  if (!(landedCost > 0)) return null;
  return round2((retailPrice / landedCost - 1) * 100);
}
