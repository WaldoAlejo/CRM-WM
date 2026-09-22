function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function totalBatchCost(costs: { freightCost?: number; customsCost?: number; otherCosts?: number }): number {
  return round2((costs.freightCost ?? 0) + (costs.customsCost ?? 0) + (costs.otherCosts ?? 0));
}

export function landedUnitCost(unitCost: number, proration: number): number {
  return round2(unitCost + proration);
}

// Keep full precision until displaying money or persisting the unit allocation.
export function costPerCbm(totalCost: number, containerCbm: number): number {
  return containerCbm > 0 ? totalCost / containerCbm : 0;
}
export function volumeCostPerUnit(rate: number, volumeCbm: number, quantity: number): number {
  return quantity > 0 ? rate * volumeCbm / quantity : 0;
}
