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

// Reparto vigente (igual que backend/src/modules/importBatches/landedCostAllocation.ts):
// flete y otros por CBM contratados; aduana por valor FOB sobre todas las líneas del lote.
export interface LandedAllocation {
  volumeRate: number; // (flete + otros) / CBM contratados
  customsCost: number;
  fobBase: number; // FOB de las líneas ya recibidas + las del formulario
}

export function buildAllocation(
  costs: { freightCost?: number; customsCost?: number; otherCosts?: number },
  containerCbm: number,
  fobBase: number,
): LandedAllocation {
  const customsCost = costs.customsCost ?? 0;
  const volumeCosts = (costs.freightCost ?? 0) + (costs.otherCosts ?? 0) + (fobBase > 0 ? 0 : customsCost);
  return { volumeRate: costPerCbm(volumeCosts, containerCbm), customsCost: fobBase > 0 ? customsCost : 0, fobBase };
}

export function lineExpenses(allocation: LandedAllocation, volumeCbm: number, lineFob: number): number {
  const customs = allocation.fobBase > 0 ? allocation.customsCost * lineFob / allocation.fobBase : 0;
  return allocation.volumeRate * volumeCbm + customs;
}
