import { describe, expect, it } from 'vitest';
import { cartonPlan, cartonStockPlan, type CartonPackaging } from '../src/lib/cartonPackaging';
import { receiveStockSchema } from '../src/modules/importBatches/importBatches.schemas';
import { computeReceiveRequestHash } from '../src/modules/importBatches/receiveRequestHash';

const pack = (cartonCount = 35, unitsPerCarton = 6): CartonPackaging => ({ cartonCount, unitsPerCarton, maxStackCartons: 3, stackingConfirmed: false });
const line = { variantId: 'v', quantity: 210, volumeCbm: 3.79, unitCost: 10, locationId: 'l', packaging: pack() };
describe('Empaque por ingreso', () => {
  it('reproduce los tres ingresos informados por China sin inventar medidas', () => {
    const plans = [[35, 6, 3.79], [12, 18, 2.15], [50, 4, 11.33]].map(([c, u, cbm]) => cartonPlan(pack(c, u), cbm)!);
    expect(plans.map(p => p.totalUnits)).toEqual([210, 216, 200]);
    expect(plans.map(p => p.piles)).toEqual([12, 4, 17]);
    expect(plans.reduce((s, p) => s + p.totalUnits, 0)).toBe(626);
    expect(plans.reduce((s, p) => s + p.totalCbm!, 0)).toBeCloseTo(17.27);
    expect(plans.reduce((s, p) => s + p.piles!, 0)).toBe(33);
    expect(plans.every(p => p.floorAreaM2 === null && p.stackHeightM === null && !p.stackingConfirmed)).toBe(true);
  });
  it('añadir medidas permite verificar altura y superficie sin reemplazar CBM del proveedor', () => {
    const p = cartonPlan({ ...pack(), cartonDimensionsCm: '60x50x40' }, 3.79, .9)!;
    expect(p.layers).toBe(2); expect(p.piles).toBe(18);
    expect(p.floorAreaM2).toBeCloseTo(5.4);
    expect(p.stackHeightM).toBeCloseTo(.8);
    expect(p.measuredCbm).toBeCloseTo(4.2); expect(p.totalCbm).toBe(3.79);
    expect(cartonPlan({ ...pack(), cartonDimensionsCm: '60x50x40' }, 3.79, .3)?.piles).toBeNull();
  });
  it('valida el empaque y conserva compatibilidad con ingresos por unidades', () => {
    expect(receiveStockSchema.safeParse({ lines: [line] }).success).toBe(true);
    expect(receiveStockSchema.safeParse({ lines: [{ ...line, packaging: undefined }] }).success).toBe(true);
    for (const packaging of [pack(0), pack(1.5), { ...pack(), maxStackCartons: 0 }, { ...pack(), cartonDimensionsCm: '60x0x40' }, pack(36)]) {
      expect(receiveStockSchema.safeParse({ lines: [{ ...line, packaging }] }).success).toBe(false);
    }
  });
  it('incluye los datos del empaque en la protección contra reintentos con datos distintos', () => {
    const hash = computeReceiveRequestHash([line]);
    expect(computeReceiveRequestHash([{ ...line, packaging: { ...pack(), maxStackCartons: 4 } }])).not.toBe(hash);
    expect(computeReceiveRequestHash([{ ...line, packaging: { ...pack(), stackingConfirmed: true } }])).not.toBe(hash);
    expect(computeReceiveRequestHash([{ ...line, packaging: { stackingConfirmed: false, maxStackCartons: 3, unitsPerCarton: 6, cartonCount: 35 } }])).toBe(hash);
  });
  it('distingue equivalencias de cartones tras un despacho, sin afirmar que estén físicamente cerrados', () => {
    const receipts = [{ quantity: 210, packaging: pack(), volumeCbm: 3.79 }];
    const result = cartonStockPlan(receipts, 205);
    expect(result).toMatchObject({ status: 'ESTIMATED', cartons: 35, fullCartonEquivalent: 34, looseUnitEquivalent: 1 });
    expect(result.plan?.piles).toBe(12);
    expect(result.volumeCbm).toBeCloseTo(3.79);
    expect(cartonStockPlan(receipts, 0)).toMatchObject({ cartons: 0, volumeCbm: 0 });
  });
  it('no inventa la asignación de lotes con empaques distintos ni con entradas sin empaque', () => {
    const receipt = { quantity: 210, packaging: pack(), volumeCbm: 3.79 };
    expect(cartonStockPlan([receipt, { quantity: 216, packaging: pack(12, 18), volumeCbm: 2.15 }], 100).status).toBe('MIXED');
    expect(cartonStockPlan([receipt, { quantity: 1, packaging: null, volumeCbm: null }], 100).status).toBe('MIXED');
  });
});
