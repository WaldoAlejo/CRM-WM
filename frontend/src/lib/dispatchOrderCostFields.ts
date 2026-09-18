// Copia literal de la lista que oculta backend/src/modules/dispatchOrders/dispatchOrders.serializer.ts
// para OPERATOR — campos DISTINTOS a PRICING_FIELDS (esos son de
// ProductVariant; estos son costos snapshot congelados en el ítem de la
// orden al momento de confirmar). Misma idea: única fuente de verdad de qué
// columnas/campos de costo armar, para no tener que sincronizar a mano cada
// vez que se toca la tabla de ítems de una orden.
export const DISPATCH_ORDER_COST_FIELDS = ["unitCostSnapshot", "landedCostSnapshot"] as const;

export type DispatchOrderCostField = (typeof DISPATCH_ORDER_COST_FIELDS)[number];
