import { parseDimensions } from './storageVolume';

export interface CartonPackaging {
  cartonCount: number;
  unitsPerCarton: number;
  maxStackCartons: number;
  stackingConfirmed: boolean;
  cartonDimensionsCm?: string | null;
}

/** Planning for the received cartons, not a lot allocation of remaining stock. */
export function cartonPlan(packaging: CartonPackaging, totalCbm: number | null, heightM?: number) {
  const { cartonCount, unitsPerCarton, maxStackCartons } = packaging;
  if (![cartonCount, unitsPerCarton, maxStackCartons].every(n => Number.isInteger(n) && n > 0)) return null;
  const dimensions = parseDimensions(packaging.cartonDimensionsCm);
  const [length, width, height] = dimensions ? dimensions.map(n => n / 100) : [];
  const layers = dimensions && heightM !== undefined ? Math.min(maxStackCartons, Math.floor((heightM + 1e-9) / height)) : maxStackCartons;
  const piles = layers > 0 ? Math.ceil(cartonCount / layers) : null;
  const measuredCbm = dimensions ? length * width * height * cartonCount : null;
  return {
    totalUnits: cartonCount * unitsPerCarton, cartonCount, layers, piles,
    totalCbm, cbmPerCarton: totalCbm === null ? null : totalCbm / cartonCount,
    cbmPerUnit: totalCbm === null ? null : totalCbm / (cartonCount * unitsPerCarton),
    measuredCbm, floorAreaM2: dimensions && piles !== null ? piles * length * width : null,
    stackHeightM: dimensions && layers > 0 ? Math.min(cartonCount, layers) * height : null,
    stackingConfirmed: packaging.stackingConfirmed,
    heightChecked: !!dimensions && heightM !== undefined,
  };
}

/** No FIFO/lot allocation exists: infer only when every incoming unit has one compatible packing. */
export function cartonStockPlan(receipts: { quantity: number; packaging: CartonPackaging | null; volumeCbm: number | null }[], stock: number, heightM?: number) {
  if (!receipts.some(r => r.packaging)) return { status: 'NONE' as const, plan: null };
  const first = receipts[0]?.packaging;
  const signature = (p: CartonPackaging) => JSON.stringify([p.unitsPerCarton, p.maxStackCartons, p.stackingConfirmed, parseDimensions(p.cartonDimensionsCm)]);
  if (!first || stock < 0 || receipts.some(r => !r.packaging || r.quantity !== r.packaging.cartonCount * r.packaging.unitsPerCarton || signature(r.packaging) !== signature(first))) {
    return { status: 'MIXED' as const, plan: null };
  }
  const cartons = Math.ceil(stock / first.unitsPerCarton);
  const volumeKnown = receipts.every(r => r.volumeCbm !== null);
  const receivedCartons = receipts.reduce((s, r) => s + r.packaging!.cartonCount, 0);
  const cbmPerCarton = volumeKnown ? receipts.reduce((s, r) => s + r.volumeCbm!, 0) / receivedCartons : null;
  const plan = cartons > 0 ? cartonPlan({ ...first, cartonCount: cartons }, cbmPerCarton === null ? null : cartons * cbmPerCarton, heightM) : null;
  return { status: 'ESTIMATED' as const, plan, cartons,
    fullCartonEquivalent: Math.floor(stock / first.unitsPerCarton), looseUnitEquivalent: stock % first.unitsPerCarton,
    volumeCbm: cartons === 0 ? 0 : plan?.totalCbm ?? null,
  };
}
