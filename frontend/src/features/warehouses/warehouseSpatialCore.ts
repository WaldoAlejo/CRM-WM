/** Pure geometry shared verbatim with the browser editor. Coordinates are metres. */
export interface Point { x: number; y: number }
export interface Slot { row: number; column: number }
export interface LegacyLayout {
  lengthM: number; widthM: number; heightM: number; cellLengthM: number; cellWidthM: number;
  hasRacks: boolean; rackLevels: number; levelHeightM: number; positions: Slot[];
}
export type ElementType = 'STORAGE' | 'WALL' | 'DOOR' | 'WINDOW' | 'DESK' | 'DISPATCH' | 'WORK' | 'COLUMN' | 'AISLE' | 'EXCLUDED';
export interface BaseElement {
  id: string; name: string; type: ElementType; x: number; y: number; width: number; depth: number; rotation: number;
}
export interface StorageElement extends BaseElement {
  type: 'STORAGE'; code: string; mode: 'FLOOR' | 'STACK' | 'RACK'; palletWidthM: number; palletDepthM: number;
  gapM: number; levels: number; levelHeightM: number; slots: Slot[]; intendedUse?: string;
}
export type SpatialElement = StorageElement | (BaseElement & { type: Exclude<ElementType, 'STORAGE'> });
export interface SpatialLayout { version: 2; heightM: number; boundary: Point[]; elements: SpatialElement[] }
export const EPS = 1e-8;
export function isSpatialLayout(layout: LegacyLayout | SpatialLayout): layout is SpatialLayout { return 'version' in layout && layout.version === 2; }
export function newSpatialLayout(): SpatialLayout {
  return { version: 2, heightM: 6, boundary: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 10 }, { x: 0, y: 10 }], elements: [] };
}
export function transformPoint(element: BaseElement, point: Point): Point {
  const angle = element.rotation * Math.PI / 180;
  return { x: element.x + point.x * Math.cos(angle) - point.y * Math.sin(angle), y: element.y + point.x * Math.sin(angle) + point.y * Math.cos(angle) };
}
export function rectanglePolygon(element: BaseElement): Point[] {
  return [{ x: 0, y: 0 }, { x: element.width, y: 0 }, { x: element.width, y: element.depth }, { x: 0, y: element.depth }].map(p => transformPoint(element, p));
}
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) <= EPS;
export function polygonArea(polygon: Point[]): number {
  return Math.abs(polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length]; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;
}
function onSegment(p: Point, a: Point, b: Point): boolean {
  return Math.abs(cross(a, b, p)) <= EPS && p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS;
}
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (onSegment(point, a, b)) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** Parameters along AB of every intersection, including collinear overlaps. */
function intersectionParameters(a: Point, b: Point, c: Point, d: Point): number[] {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const determinant = rx * sy - ry * sx;
  if (Math.abs(determinant) > EPS) {
    const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / determinant;
    const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / determinant;
    return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS ? [Math.min(1, Math.max(0, t))] : [];
  }
  const lengthSquared = rx * rx + ry * ry;
  if (lengthSquared <= EPS * EPS) return onSegment(a, c, d) ? [0] : [];
  if (Math.abs(cross(a, b, c)) > EPS) return [];
  const t1 = ((c.x - a.x) * rx + (c.y - a.y) * ry) / lengthSquared;
  const t2 = ((d.x - a.x) * rx + (d.y - a.y) * ry) / lengthSquared;
  const low = Math.max(0, Math.min(t1, t2)), high = Math.min(1, Math.max(t1, t2));
  return low <= high + EPS ? [low, high] : [];
}
export function simplePolygon(polygon: Point[]): boolean {
  if (polygon.length < 3 || polygonArea(polygon) <= EPS) return false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], c = polygon[(i + 2) % polygon.length];
    if (near(a, b)) return false;
    // Adjacent edges may be collinear but must not double back.
    if (Math.abs(cross(a, b, c)) <= EPS && (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) > EPS) return false;
    for (let j = i + 1; j < polygon.length; j++) {
      if (j === i + 1 || (i === 0 && j === polygon.length - 1)) continue;
      if (intersectionParameters(a, b, polygon[j], polygon[(j + 1) % polygon.length]).length) return false;
    }
  }
  return true;
}
/** Checks entire edges, not just corners (essential for concave warehouse outlines). */
export function polygonContainsPolygon(boundary: Point[], polygon: Point[]): boolean {
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (!pointInPolygon(a, boundary)) return false;
    const cuts = [0, 1];
    for (let j = 0; j < boundary.length; j++) cuts.push(...intersectionParameters(a, b, boundary[j], boundary[(j + 1) % boundary.length]));
    cuts.sort((x, y) => x - y);
    for (let j = 1; j < cuts.length; j++) {
      const t = (cuts[j - 1] + cuts[j]) / 2;
      if (!pointInPolygon({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, boundary)) return false;
    }
  }
  return true;
}
/** Positive-area intersection for convex rectangles; touching edges are permitted. */
export function rectanglesOverlap(a: Point[], b: Point[]): boolean {
  for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    const nx = -(q.y - p.y), ny = q.x - p.x;
    const aa = a.map(v => v.x * nx + v.y * ny), bb = b.map(v => v.x * nx + v.y * ny);
    if (Math.min(Math.max(...aa), Math.max(...bb)) - Math.max(Math.min(...aa), Math.min(...bb)) <= EPS * Math.hypot(nx, ny)) return false;
  }
  return true;
}
/** Work/circulation areas are envelopes; furniture and openings may lie in them. */
export function permitsOverlap(a: SpatialElement, b: SpatialElement): boolean {
  if (a.type === 'STORAGE' || b.type === 'STORAGE') return false;
  const pair = (outer: SpatialElement, inner: SpatialElement) => {
    if (outer.type === 'WALL' && ['WALL', 'DOOR', 'WINDOW', 'COLUMN'].includes(inner.type)) return true;
    if (outer.type === 'EXCLUDED' && ['WALL', 'COLUMN'].includes(inner.type)) return true;
    if (['AISLE', 'WORK'].includes(outer.type) && inner.type === 'DOOR') return true;
    return outer.type === 'WORK' && ['DESK', 'DISPATCH', 'COLUMN'].includes(inner.type) && polygonContainsPolygon(rectanglePolygon(outer), rectanglePolygon(inner));
  };
  return pair(a, b) || pair(b, a);
}
/** Exact union area of straight-edged polygons via piecewise-linear horizontal slices. */
export function unionArea(polygons: Point[][]): number {
  if (!polygons.length) return 0;
  const edges = polygons.flatMap(p => p.map((a, i) => [a, p[(i + 1) % p.length]] as const));
  const heights = polygons.flatMap(p => p.map(v => v.y));
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const [a, b] = edges[i], [c, d] = edges[j];
    for (const t of intersectionParameters(a, b, c, d)) heights.push(a.y + (b.y - a.y) * t);
  }
  const ys = [...new Set(heights)].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < ys.length; i++) {
    const dy = ys[i] - ys[i - 1]; if (dy <= EPS) continue;
    const y = (ys[i] + ys[i - 1]) / 2;
    const intervals: [number, number][] = [];
    for (const polygon of polygons) {
      const xs: number[] = [];
      for (let k = 0; k < polygon.length; k++) {
        const a = polygon[k], b = polygon[(k + 1) % polygon.length];
        if ((a.y > y) !== (b.y > y)) xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) intervals.push([xs[k], xs[k + 1]]);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let width = 0, right = -Infinity;
    for (const [left, end] of intervals) { width += Math.max(0, end - Math.max(left, right)); right = Math.max(right, end); }
    area += width * dy;
  }
  return area;
}
export function storageGrid(storage: StorageElement) {
  return { rows: Math.floor((storage.depth + storage.gapM) / (storage.palletDepthM + storage.gapM) + EPS), columns: Math.floor((storage.width + storage.gapM) / (storage.palletWidthM + storage.gapM) + EPS) };
}
const pad = (n: number) => String(n).padStart(2, '0');
export function spatialLocationCount(layout: SpatialLayout): number {
  return layout.elements.reduce((sum, e) => sum + (e.type !== 'STORAGE' ? 0 : e.mode === 'FLOOR' ? 1 : e.mode === 'STACK' ? e.levels : e.levels * e.slots.length), 0);
}
export function spatialLocations(layout: SpatialLayout) {
  return layout.elements.flatMap(element => {
    if (element.type !== 'STORAGE') return [];
    const base = { aisle: element.code, shelf: null as string | null, type: 'STANDARD' as const, layoutManaged: true };
    if (element.mode === 'FLOOR') return [{ ...base, code: element.code, level: '0' }];
    return Array.from({ length: element.levels }, (_, i) => {
      const level = i + 1, code = `${element.code}-N${pad(level)}`;
      if (element.mode === 'STACK' || element.slots.length === 1) return [{ ...base, code, level: String(level) }];
      return element.slots.map(slot => ({ ...base, code: `${code}-P${pad(slot.row + 1)}-${pad(slot.column + 1)}`, shelf: `${pad(slot.row + 1)}-${pad(slot.column + 1)}`, level: String(level) }));
    }).flat();
  });
}
export function spatialMetrics(layout: SpatialLayout) {
  const polygons = (elements: SpatialElement[]) => elements.map(rectanglePolygon);
  const excluded = layout.elements.filter(e => e.type === 'EXCLUDED' || e.type === 'WALL' || e.type === 'COLUMN');
  const nonStorage = layout.elements.filter(e => e.type !== 'STORAGE');
  const storage = layout.elements.filter((e): e is StorageElement => e.type === 'STORAGE');
  const doors = layout.elements.filter(e => e.type === 'DOOR');
  const totalAreaM2 = polygonArea(layout.boundary);
  // Door openings are usable circulation, even where their footprint cuts a wall.
  const excludedAreaM2 = Math.max(0, unionArea(polygons([...excluded, ...doors])) - unionArea(polygons(doors)));
  const reservedAreaM2 = Math.max(0, unionArea(polygons(nonStorage)) - excludedAreaM2);
  const storageAreaM2 = unionArea(polygons(storage));
  const usableAreaM2 = Math.max(0, totalAreaM2 - excludedAreaM2);
  return { totalAreaM2, excludedAreaM2, usableAreaM2, reservedAreaM2, storageAreaM2,
    freeAreaM2: Math.max(0, usableAreaM2 - reservedAreaM2 - storageAreaM2),
    capacityCbm: storage.reduce((sum, e) => sum + e.slots.length * e.palletWidthM * e.palletDepthM * e.levels * e.levelHeightM, 0),
    palletCapacity: storage.reduce((sum, e) => sum + e.slots.length * e.levels, 0), locationCount: spatialLocationCount(layout) };
}
export function validateSpatialLayout(layout: SpatialLayout): string[] {
  const errors: string[] = [];
  if (!simplePolygon(layout.boundary)) errors.push('El perímetro debe formar un polígono sin cruces, vértices repetidos ni lados superpuestos.');
  const ids = new Set<string>(), codes = new Set<string>();
  const polygons = layout.elements.map(rectanglePolygon);
  for (let i = 0; i < layout.elements.length; i++) {
    const e = layout.elements[i];
    if (ids.has(e.id)) errors.push('Los elementos del plano deben tener identificadores únicos.'); ids.add(e.id);
    if (!polygonContainsPolygon(layout.boundary, polygons[i])) errors.push(`${e.name}: está fuera del perímetro de la bodega.`);
    if (e.type === 'STORAGE') {
      if (e.code.toLowerCase() === 'cuarentena') errors.push('El código Cuarentena está reservado.');
      if (e.mode === 'FLOOR' && e.levels !== 1) errors.push(`${e.name}: una ubicación en piso tiene un solo nivel; usa Apilado para varios.`);
      if (e.levels * e.levelHeightM > layout.heightM + EPS) errors.push(`${e.name}: los niveles superan la altura de la bodega.`);
      const { rows, columns } = storageGrid(e);
      const slots = new Set<string>();
      for (const s of e.slots) {
        const key = `${s.row}:${s.column}`;
        if (s.row >= rows || s.column >= columns) errors.push(`${e.name}: hay pallets que no caben en la zona.`);
        if (slots.has(key)) errors.push(`${e.name}: hay posiciones de pallet repetidas.`); slots.add(key);
      }
    }
    for (let j = 0; j < i; j++) {
      const other = layout.elements[j];
      if (permitsOverlap(e, other)) continue;
      if (rectanglesOverlap(polygons[i], polygons[j])) errors.push(`${e.name} se superpone con ${other.name}.`);
    }
  }
  if (spatialLocationCount(layout) > 5000) return [...new Set([...errors, 'El plano admite hasta 5000 ubicaciones de inventario.'])];
  const locations = spatialLocations(layout);
  for (const location of locations) {
    const key = location.code.toLowerCase();
    if (codes.has(key)) errors.push(`El código ${location.code} está repetido entre zonas.`); codes.add(key);
  }
  return [...new Set(errors)];
}
export function toSpatialLayout(layout: LegacyLayout | SpatialLayout): SpatialLayout {
  if (isSpatialLayout(layout)) return layout;
  return { version: 2, heightM: layout.heightM,
    boundary: [{ x: 0, y: 0 }, { x: layout.widthM, y: 0 }, { x: layout.widthM, y: layout.lengthM }, { x: 0, y: layout.lengthM }],
    elements: layout.positions.map(({ row, column }) => {
      const code = `${layout.hasRacks ? 'R' : 'P'}-${pad(row + 1)}-${pad(column + 1)}`;
      return { id: `legacy-${row}-${column}`, type: 'STORAGE', name: code, code,
        x: column * layout.cellWidthM, y: row * layout.cellLengthM, width: layout.cellWidthM, depth: layout.cellLengthM, rotation: 0,
        mode: layout.hasRacks ? 'RACK' : 'FLOOR', palletWidthM: layout.cellWidthM, palletDepthM: layout.cellLengthM, gapM: 0,
        levels: layout.hasRacks ? layout.rackLevels : 1, levelHeightM: layout.hasRacks ? layout.levelHeightM : Math.min(layout.levelHeightM, layout.heightM), slots: [{ row: 0, column: 0 }] };
    }) };
}
/** Physical identity of each inventory address; names/intended use can change freely. */
export function locationFingerprints(layout: LegacyLayout | SpatialLayout): Map<string, string> {
  const spatial = toSpatialLayout(layout), result = new Map<string, string>();
  for (const element of spatial.elements) if (element.type === 'STORAGE') {
    const locations = spatialLocations({ ...spatial, elements: [element] });
    for (const location of locations) {
      const slots = element.mode === 'RACK' && element.slots.length > 1
        ? element.slots.filter(s => location.code.endsWith(`-P${pad(s.row + 1)}-${pad(s.column + 1)}`))
        : [...element.slots].sort((a, b) => a.row - b.row || a.column - b.column);
      result.set(location.code, JSON.stringify({ x: element.x, y: element.y, width: element.width, depth: element.depth,
        rotation: element.rotation, mode: element.mode, palletWidthM: element.palletWidthM, palletDepthM: element.palletDepthM,
        gapM: element.gapM, levelHeightM: element.levelHeightM, level: location.level, slots }));
    }
  }
  return result;
}

export function layoutVolumeCbm(layout: LegacyLayout | SpatialLayout): number {
  if (isSpatialLayout(layout)) return spatialMetrics(layout).capacityCbm;
  return layout.positions.length * layout.cellLengthM * layout.cellWidthM * (layout.hasRacks ? layout.rackLevels * layout.levelHeightM : Math.min(layout.levelHeightM, layout.heightM));
}

/** Geometric capacity for one generated location, excluding circulation gaps. */
export function locationStorageSpace(layout: LegacyLayout | SpatialLayout, code: string): { areaM2: number; heightM: number } | null {
  if (!isSpatialLayout(layout)) {
    const converted = toSpatialLayout(layout);
    return locationStorageSpace(converted, code);
  }
  for (const element of layout.elements) {
    if (element.type !== 'STORAGE') continue;
    if (!spatialLocations({ ...layout, elements: [element] }).some(l => l.code === code)) continue;
    return { areaM2: element.palletWidthM * element.palletDepthM * (element.mode === 'RACK' ? 1 : element.slots.length), heightM: element.levelHeightM };
  }
  return null;
}
