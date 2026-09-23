import { z } from "zod";

export const warehouseLayoutSchema = z.object({
  lengthM: z.number().positive("El largo debe ser mayor que cero.").max(200, "El largo máximo es 200 m."),
  widthM: z.number().positive("El ancho debe ser mayor que cero.").max(200, "El ancho máximo es 200 m."),
  heightM: z.number().positive("La altura debe ser mayor que cero.").max(200, "La altura máxima es 200 m."),
  cellLengthM: z.number().min(0.2, "El largo de posición mínimo es 0,2 m.").max(10, "El largo de posición máximo es 10 m."),
  cellWidthM: z.number().min(0.2, "El ancho de posición mínimo es 0,2 m.").max(10, "El ancho de posición máximo es 10 m."),
  hasRacks: z.boolean(),
  rackLevels: z.number().int("Los niveles deben ser enteros.").min(1, "Cada rack requiere al menos un nivel.").max(10, "Se permiten hasta 10 niveles."),
  levelHeightM: z.number().positive("La altura por nivel debe ser mayor que cero.").max(20, "La altura por nivel máxima es 20 m."),
  positions: z.array(z.object({ row: z.number().int().nonnegative(), column: z.number().int().nonnegative() })).max(400),
}).superRefine((layout, ctx) => {
  const { rows, columns } = layoutGrid(layout);
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (rows < 1 || columns < 1) issue("La bodega debe contener al menos una posición del tamaño indicado.");
  if (rows > 20 || columns > 20 || rows * columns > 400) issue("El plano admite hasta 20 filas y 20 columnas. Aumenta el tamaño de las posiciones.");
  if (layout.hasRacks && layout.rackLevels * layout.levelHeightM > layout.heightM + 1e-8) issue("Los niveles del rack superan la altura de la bodega.");
  if (layout.positions.some(p => p.row >= rows || p.column >= columns)) issue("Hay posiciones fuera de las nuevas dimensiones. Amplía el plano o limpia la selección antes de reducirlo.");
  if (new Set(layout.positions.map(p => `${p.row}:${p.column}`)).size !== layout.positions.length) issue("Hay posiciones repetidas.");
});

export type WarehouseLayout = z.infer<typeof warehouseLayoutSchema>;
export function layoutGrid(layout: WarehouseLayout) {
  return { rows: Math.floor(layout.lengthM / layout.cellLengthM + 1e-8), columns: Math.floor(layout.widthM / layout.cellWidthM + 1e-8) };
}
export function layoutCapacity(layout: WarehouseLayout) {
  return layout.positions.length * (layout.hasRacks ? layout.rackLevels : 1);
}
export function positionCode(row: number, column: number, racks: boolean) {
  return `${racks ? "R" : "P"}-${String(row + 1).padStart(2, "0")}-${String(column + 1).padStart(2, "0")}${racks ? "-N01" : ""}`;
}
export function newWarehouseLayout(): WarehouseLayout {
  return { lengthM: 12, widthM: 10, heightM: 4, cellLengthM: 1.2, cellWidthM: 1, hasRacks: false, rackLevels: 2, levelHeightM: 2, positions: [] };
}
