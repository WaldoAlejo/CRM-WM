import { describe, expect, it } from 'vitest';
import { spatialLayoutSchema } from '../src/modules/warehouses/warehouseSpatial.schemas';
import { layoutCapacity, layoutLocations } from '../src/modules/warehouses/warehouseLayout';
import { newSpatialLayout, polygonArea, polygonContainsPolygon, rectanglePolygon, spatialMetrics, toSpatialLayout, unionArea, locationFingerprints, type SpatialLayout, type StorageElement, type SpatialElement } from '../src/modules/warehouses/warehouseSpatialCore';

const storage = (patch: Partial<StorageElement> = {}): StorageElement => ({ id: 's1', name: 'Ubicación 1', type: 'STORAGE', code: 'UB1', x: 1, y: 1, width: 2.4, depth: 1, rotation: 0, mode: 'FLOOR', palletWidthM: 1.2, palletDepthM: 1, gapM: 0, levels: 1, levelHeightM: 1.5, slots: [{ row: 0, column: 0 }, { row: 0, column: 1 }], ...patch });
const layout = (...elements: SpatialElement[]): SpatialLayout => ({ ...newSpatialLayout(), elements });

describe('Geometría del espacio de bodega', () => {
  it('distingue dos ubicaciones en piso de sus tres posiciones pallet', () => {
    const plan = layout(storage(), storage({ id: 's2', code: 'UB2', x: 5, width: 1.2, slots: [{ row: 0, column: 0 }] }));
    expect(spatialLayoutSchema.safeParse(plan).success).toBe(true);
    expect(layoutLocations(plan).map(e => e.code)).toEqual(['UB1', 'UB2']);
    expect(layoutCapacity(plan)).toBe(3);
    expect(spatialMetrics(plan)).toMatchObject({ palletCapacity: 3, locationCount: 2, totalAreaM2: 120 });
  });
  it('combina apilado de tres niveles y rack alto con posiciones por nivel', () => {
    const plan = { ...layout(storage({ mode: 'STACK', levels: 3 }), storage({ id: 'rack', code: 'RACK', x: 5, mode: 'RACK', levels: 12 })), heightM: 20 };
    expect(spatialLayoutSchema.safeParse(plan).success).toBe(true);
    expect(layoutCapacity(plan)).toBe(30);
    expect(layoutLocations(plan)).toHaveLength(27);
    expect(layoutLocations(plan).map(e => e.code)).toContain('RACK-N12-P01-02');
    expect(layoutLocations(plan).map(e => e.code)).toContain('UB1-N03');
  });
  it('calcula área de perímetro irregular y áreas reservadas sin duplicar puertas dentro de paredes', () => {
    const plan = layout(
      { id: 'wall', name: 'División', type: 'WALL', x: 1, y: 3, width: 8, depth: 0.2, rotation: 0 },
      { id: 'door', name: 'Puerta', type: 'DOOR', x: 2, y: 3, width: 1, depth: 1, rotation: 0 },
      { id: 'desk', name: 'Escritorio', type: 'DESK', x: 1, y: 1, width: 1.5, depth: 0.8, rotation: 0 },
      storage({ x: 5, y: 1 }),
    );
    plan.boundary = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 10 }];
    expect(spatialLayoutSchema.safeParse(plan).success).toBe(true);
    const metrics = spatialMetrics(plan);
    expect(metrics.totalAreaM2).toBe(85);
    expect(metrics.excludedAreaM2).toBeCloseTo(1.4);
    expect(metrics.reservedAreaM2).toBeCloseTo(2.2);
    expect(metrics.storageAreaM2).toBeCloseTo(2.4);
    expect(metrics.freeAreaM2).toBeCloseTo(79);
  });
  it('no acepta un objeto que atraviesa una entrante aunque sus esquinas estén dentro', () => {
    const boundary = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 5, y: 8 }, { x: 5, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 8 }, { x: 0, y: 8 }];
    const zone = storage({ x: 1, y: 4, width: 6, depth: 1 });
    expect(polygonContainsPolygon(boundary, rectanglePolygon(zone))).toBe(false);
    expect(spatialLayoutSchema.safeParse({ ...layout(zone), boundary }).success).toBe(false);
  });
  it('permite mobiliario dentro de un área de trabajo y puertas sobre pasillos sin duplicar superficie', () => {
    const work = { id: 'work', name: 'Oficina', type: 'WORK' as const, x: 1, y: 1, width: 4, depth: 3, rotation: 0 };
    const desk = { id: 'desk', name: 'Escritorio', type: 'DESK' as const, x: 2, y: 2, width: 1.5, depth: .8, rotation: 0 };
    const aisle = { id: 'aisle', name: 'Pasillo', type: 'AISLE' as const, x: 6, y: 1, width: 2, depth: 8, rotation: 0 };
    const door = { id: 'door', name: 'Puerta', type: 'DOOR' as const, x: 6, y: 1, width: 1, depth: 1, rotation: 0 };
    const plan = layout(work, desk, aisle, door);
    expect(spatialLayoutSchema.safeParse(plan).success).toBe(true);
    expect(spatialMetrics(plan).reservedAreaM2).toBeCloseTo(28);
    expect(spatialLayoutSchema.safeParse(layout(work, { ...desk, x: 4.5 })).success).toBe(false);
    expect(spatialLayoutSchema.safeParse(layout(work, desk, { ...desk, id: 'desk2' })).success).toBe(false);
  });
  it('admite rotación y lados inclinados, y unión exacta de rectángulos rotados', () => {
    const a = storage({ width: 2, depth: 2, x: 4, y: 2, rotation: 45, palletWidthM: 1, palletDepthM: 1 });
    const b = { ...a, x: a.x + Math.SQRT1_2, y: a.y + Math.SQRT1_2 };
    expect(polygonArea(rectanglePolygon(a))).toBeCloseTo(4);
    expect(unionArea([rectanglePolygon(a), rectanglePolygon(b)])).toBeCloseTo(6);
    const plan = { ...layout(a), boundary: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 8 }] };
    expect(spatialLayoutSchema.safeParse(plan).success).toBe(true);
  });
  it.each([
    ['alturas excesivas', (p: SpatialLayout) => { (p.elements[0] as StorageElement).mode = 'RACK'; (p.elements[0] as StorageElement).levels = 10; }],
    ['palets fuera de zona', (p: SpatialLayout) => { (p.elements[0] as StorageElement).slots.push({ row: 8, column: 0 }); }],
    ['pisos con varios niveles', (p: SpatialLayout) => { (p.elements[0] as StorageElement).levels = 2; }],
    ['palets repetidos', (p: SpatialLayout) => { (p.elements[0] as StorageElement).slots.push({ row: 0, column: 0 }); }],
    ['código reservado', (p: SpatialLayout) => { (p.elements[0] as StorageElement).code = 'Cuarentena'; }],
    ['identificador repetido', (p: SpatialLayout) => { p.elements.push(storage({ code: 'UB2', x: 5 })); }],
    ['código repetido', (p: SpatialLayout) => { p.elements.push(storage({ id: 's2', x: 5 })); }],
    ['superposición con mesa', (p: SpatialLayout) => { p.elements.push({ id: 'desk', type: 'DESK', name: 'Mesa', x: 2, y: 1, width: 1, depth: 1, rotation: 0 }); }],
    ['perímetro cruzado', (p: SpatialLayout) => { p.boundary = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }]; }],
    ['esquina duplicada', (p: SpatialLayout) => { p.boundary.push({ x: 0, y: 0 }); }],
  ])('rechaza %s', (_, mutate) => {
    const plan = layout(storage()); mutate(plan);
    expect(spatialLayoutSchema.safeParse(plan).success).toBe(false);
  });
  it('permite contacto entre zonas y rechaza rebasar por un lado rotado', () => {
    expect(spatialLayoutSchema.safeParse(layout(storage(), storage({ id: 's2', code: 'UB2', x: 3.4 }))).success).toBe(true);
    expect(spatialLayoutSchema.safeParse(layout(storage({ x: 0, rotation: 45 }))).success).toBe(false);
  });
  it.each([false, true])('convierte plano anterior sin cambiar códigos ni direcciones físicas (racks=%s)', hasRacks => {
    const legacy = { lengthM: 8, widthM: 6, heightM: 6, cellLengthM: 1.2, cellWidthM: 1, hasRacks, rackLevels: 3, levelHeightM: 1.5, positions: [{ row: 0, column: 0 }, { row: 2, column: 1 }] };
    const converted = toSpatialLayout(legacy);
    expect(spatialLayoutSchema.safeParse(converted).success).toBe(true);
    expect(layoutLocations(converted).map(e => e.code).sort()).toEqual(layoutLocations(legacy).map(e => e.code).sort());
    expect(locationFingerprints(converted)).toEqual(locationFingerprints(legacy));
    expect(layoutCapacity(converted)).toBe(layoutCapacity(legacy));
  });
  it('limita cantidad de ubicaciones antes de construir una lista gigantesca', () => {
    const slots = Array.from({ length: 400 }, (_, i) => ({ row: Math.floor(i / 20), column: i % 20 }));
    const plan = { ...layout(storage({ width: 24, depth: 20, slots, mode: 'RACK', levels: 50 })), heightM: 100, boundary: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    expect(spatialLayoutSchema.safeParse(plan).success).toBe(false);
  });
});
