// Espejo de la regla de negocio de receiveStock (backend/importBatches.service.ts):
// los 3 costos del lote se reparten en partes IGUALES por unidad (no por valor
// ni por CBM) entre TODAS las unidades de ESTE receive — si el lote se recibe
// en varias tandas, cada tanda prorratea solo entre sus propias líneas.
// Es una vista previa: el valor definitivo lo calcula y guarda el servidor.
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function totalBatchCost(costs: { freightCost?: number; customsCost?: number; otherCosts?: number }): number {
  return round2((costs.freightCost ?? 0) + (costs.customsCost ?? 0) + (costs.otherCosts ?? 0));
}

export function prorationPerUnit(totalCost: number, totalUnits: number): number {
  return totalUnits > 0 ? round2(totalCost / totalUnits) : 0;
}

export function landedUnitCost(unitCost: number, proration: number): number {
  return round2(unitCost + proration);
}
