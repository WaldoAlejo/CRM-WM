import { Prisma } from "@prisma/client";
import { z } from "zod";
import { conflict } from "../../utils/httpError";
import { spatialLayoutSchema } from './warehouseSpatial.schemas';
import { isSpatialLayout, spatialLocations, locationFingerprints } from './warehouseSpatialCore';

export const legacyWarehouseLayoutSchema = z.object({
  lengthM: z.number().positive().max(200),
  widthM: z.number().positive().max(200),
  heightM: z.number().positive().max(200),
  cellLengthM: z.number().min(0.2).max(10),
  cellWidthM: z.number().min(0.2).max(10),
  hasRacks: z.boolean(),
  rackLevels: z.number().int().min(1).max(10),
  levelHeightM: z.number().positive().max(20),
  positions: z.array(z.object({ row: z.number().int().min(0), column: z.number().int().min(0) })).max(400),
}).superRefine((layout, ctx) => {
  const rows = Math.floor(layout.lengthM / layout.cellLengthM + 1e-8);
  const columns = Math.floor(layout.widthM / layout.cellWidthM + 1e-8);
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (rows < 1 || columns < 1 || rows > 20 || columns > 20) fail("El plano debe tener entre 1 y 20 filas y columnas; ajusta las dimensiones de las posiciones.");
  if (layout.hasRacks && layout.rackLevels * layout.levelHeightM > layout.heightM + 1e-8) fail("Los niveles del rack superan la altura de la bodega.");
  const seen = new Set<string>();
  for (const cell of layout.positions) {
    const key = `${cell.row}:${cell.column}`;
    if (cell.row >= rows || cell.column >= columns) fail("Hay posiciones fuera de los límites de la bodega.");
    if (seen.has(key)) fail("No se puede repetir una posición.");
    seen.add(key);
  }
});

export const warehouseLayoutSchema = z.union([spatialLayoutSchema, legacyWarehouseLayoutSchema]);
export type WarehouseLayout = z.infer<typeof warehouseLayoutSchema>;
export function layoutCapacity(layout: WarehouseLayout): number {
  return isSpatialLayout(layout)
    ? layout.elements.reduce((sum, e) => sum + (e.type === 'STORAGE' ? e.slots.length * e.levels : 0), 0)
    : layout.positions.length * (layout.hasRacks ? layout.rackLevels : 1);
}
export function layoutLocations(layout: WarehouseLayout) {
  if (isSpatialLayout(layout)) return spatialLocations(layout);
  return layout.positions.flatMap(({ row, column }) => {
    const r = String(row + 1).padStart(2, "0"), c = String(column + 1).padStart(2, "0");
    return Array.from({ length: layout.hasRacks ? layout.rackLevels : 1 }, (_, index) => ({
      code: layout.hasRacks ? `R-${r}-${c}-N${String(index + 1).padStart(2, "0")}` : `P-${r}-${c}`,
      aisle: r, shelf: c, level: String(layout.hasRacks ? index + 1 : 0),
      type: "STANDARD" as const, layoutManaged: true,
    }));
  });
}

/** Only unused generated locations can be removed. Manual locations are untouched. */
export async function syncWarehouseLayout(tx: Prisma.TransactionClient, warehouseId: string, layout: WarehouseLayout, previousLayout?: WarehouseLayout | null) {
  const wanted = layoutLocations(layout);
  const codes = new Set(wanted.map(x => x.code));
  const previousFingerprints = previousLayout ? locationFingerprints(previousLayout) : new Map<string, string>();
  const nextFingerprints = locationFingerprints(layout);
  const existing = await tx.location.findMany({ where: { warehouseId }, include: { _count: { select: {
    movementsFrom: true, movementsTo: true, dispatchItems: true, consignmentLines: true,
    returnLinesOrigin: true, returnLinesQuarantine: true,
  } } } });
  for (const location of existing) {
    const hasHistory = Object.values(location._count).some(count => count > 0);
    if (location.layoutManaged && hasHistory && codes.has(location.code) &&
      previousFingerprints.get(location.code) !== nextFingerprints.get(location.code)) {
      throw conflict(`No se puede mover ni redefinir ${location.code}: tiene movimientos o documentos asociados. Conserva su posición y configuración.`, { field: "layout" });
    }
    if (codes.has(location.code) && !location.layoutManaged) throw conflict(`El código ${location.code} ya pertenece a una ubicación manual. Cambia esa posición del plano.`, { field: "layout" });
    if (location.layoutManaged && !codes.has(location.code)) {
      if (hasHistory) throw conflict(`No se puede quitar ${location.code}: tiene movimientos o documentos asociados. Conserva esta posición.`, { field: "layout" });
      // Physical deletion of unused rows avoids accumulating invisible positions.
      // Foreign keys also prevent deleting a concurrently referenced location.
      await tx.location.delete({ where: { id: location.id } });
    }
  }
  const byCode = new Map(existing.map(x => [x.code, x]));
  const newLocations = wanted.filter(x => !byCode.has(x.code));
  if (newLocations.length) await tx.location.createMany({ data: newLocations.map(x => ({ ...x, warehouseId })) });
  for (const location of wanted) {
    const previous = byCode.get(location.code);
    if (previous && !previous.isActive) await tx.location.update({ where: { id: previous.id }, data: { isActive: true } });
  }
}
