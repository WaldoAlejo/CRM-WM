// Copia literal de backend/src/modules/variants/pricingFields.ts — misma
// lista, mismo propósito: única fuente de verdad de "qué campos son
// precio/costo", reusada por el formulario de variante (qué inputs armar) y
// por la tabla de variantes (qué columnas armar). Si el backend agrega un
// campo de precio nuevo, se replica acá.
export const PRICING_FIELDS = [
  "costPriceCNY",
  "wholesalePrice",
  "wholesaleDiscountPct",
  "retailPrice",
  "retailDiscountPct",
] as const;

export type PricingField = (typeof PRICING_FIELDS)[number];
