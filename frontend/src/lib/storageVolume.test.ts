import { describe, expect, it } from 'vitest';
import { parseDimensions, storageEstimate } from './storageVolume';
import { layoutVolumeCbm, locationStorageSpace, newSpatialLayout, type StorageElement } from '@/features/warehouses/warehouseSpatialCore';

describe('Volumen y apilamiento', () => {
  it('apilar cambia superficie, no volumen; cuenta la pila incompleta', () => {
    const single = storageEstimate('50x40x30', 20, 1)!;
    const stacked = storageEstimate('50x40x30', 20, 3)!;
    expect(single.totalCbm).toBeCloseTo(1.2);
    expect(stacked.totalCbm).toBe(single.totalCbm);
    expect(single.floorAreaM2).toBeCloseTo(4);
    expect(stacked.floorAreaM2).toBeCloseTo(1.4);
    expect(stacked.stackHeightM).toBeCloseTo(.9);
  });
  it('limita por altura y maneja empaques que no caben, decimales y datos ausentes', () => {
    expect(storageEstimate('50x40x30', 20, 10, .8)?.layers).toBe(2);
    expect(storageEstimate('50x40x30', 20, 10, .2)?.floorAreaM2).toBeNull();
    expect(parseDimensions('50,5 × 40 × 30')).toEqual([50.5, 40, 30]);
    expect(storageEstimate(null, 20, 1)).toBeNull();
    expect(parseDimensions('50x0x30')).toBeNull();
    expect(storageEstimate('50x40x30', 0, 3)?.floorAreaM2).toBe(0);
  });
  it('calcula m³ por zona y por ubicación sin sumar separación ni mobiliario', () => {
    const zone: StorageElement = { id: 's', name: 'Zona', code: 'Z', type: 'STORAGE', x: 0, y: 0, width: 3, depth: 2, rotation: 0, mode: 'RACK', palletWidthM: 1.2, palletDepthM: 1, levels: 3, levelHeightM: 1.5, gapM: .1, slots: [{ row: 0, column: 0 }, { row: 0, column: 1 }] };
    const layout = { ...newSpatialLayout(), elements: [zone] };
    expect(layoutVolumeCbm(layout)).toBeCloseTo(10.8);
    expect(locationStorageSpace(layout, 'Z-N01-P01-01')).toEqual({ areaM2: 1.2, heightM: 1.5 });
    expect(locationStorageSpace(layout, 'missing')).toBeNull();
    zone.mode = 'STACK';
    expect(locationStorageSpace(layout, 'Z-N01')).toEqual({ areaM2: 2.4, heightM: 1.5 });
  });
});
