// Única fuente de verdad de "qué campos son precio/costo": la usan tanto el
// guard de escritura (forbidFieldsForRole) como el serializador de lectura
// (serializeVariantForRole). Si el día de mañana se agrega un campo de precio
// nuevo, se edita en un solo lugar y ambas protecciones quedan al día.
export const PRICING_FIELDS = [
  "weightedAverageCost",
  "costPriceUSD",
  "wholesalePrice",
  "wholesaleDiscountPct",
  "retailPrice",
  "retailDiscountPct",
] as const;
