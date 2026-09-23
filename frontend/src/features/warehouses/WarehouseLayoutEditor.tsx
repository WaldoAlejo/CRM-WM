import { useEffect, useRef, useState } from "react";
import { Eraser, Grid2X2, MousePointer2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { layoutCapacity, layoutGrid, positionCode, warehouseLayoutSchema } from "./warehouseLayout";
import type { WarehouseLayout } from "./warehouseLayout";

interface Props {
  value: WarehouseLayout;
  onChange: (value: WarehouseLayout) => void;
  disabled?: boolean;
}

export function WarehouseLayoutEditor({ value, onChange, disabled }: Props) {
  const [tool, setTool] = useState<"select" | "erase">("select");
  const [confirmClear, setConfirmClear] = useState(false);
  const ignoreClick = useRef(false);
  const latest = useRef(value);
  useEffect(() => { latest.current = value; }, [value]);
  const { rows, columns } = layoutGrid(value);
  const validGrid = Number.isFinite(rows) && Number.isFinite(columns) && rows > 0 && columns > 0 && rows <= 20 && columns <= 20;
  const validation = warehouseLayoutSchema.safeParse(value);
  const positions = new Set(value.positions.map(p => `${p.row}:${p.column}`));
  const change = (next: WarehouseLayout) => { latest.current = next; onChange(next); };
  const numberField = (name: "lengthM" | "widthM" | "heightM" | "cellLengthM" | "cellWidthM" | "rackLevels" | "levelHeightM", label: string, min: number, max: number, step: number | "any" = "any") => (
    <label className="grid gap-1.5 text-sm font-medium" key={name}>
      {label}
      <Input type="number" value={value[name] || ""} min={min} max={max} step={step} disabled={disabled}
        onChange={event => change({ ...value, [name]: Number(event.target.value) })} />
    </label>
  );
  function paint(row: number, column: number) {
    if (disabled) return;
    const current = latest.current;
    const exists = current.positions.some(p => p.row === row && p.column === column);
    if ((tool === "select" && exists) || (tool === "erase" && !exists)) return;
    change({ ...current, positions: tool === "select" ? [...current.positions, { row, column }] : current.positions.filter(p => p.row !== row || p.column !== column) });
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label="Diseñador de ubicaciones">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2"><Grid2X2 className="size-4 text-teal-700" /><h3 className="font-semibold">Plano de ubicaciones</h3></div>
        <span className="text-xs font-medium text-slate-600">VISTA SUPERIOR · METROS</span>
      </div>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-3 gap-3">
          {numberField("lengthM", "Largo (m)", 0.1, 200)}
          {numberField("widthM", "Ancho (m)", 0.1, 200)}
          {numberField("heightM", "Altura (m)", 0.1, 200)}
        </div>
        <div className="grid gap-4 border-b pb-4 sm:grid-cols-2">
          <div className="space-y-2"><p className="text-sm font-medium">Tamaño de cada posición / pallet</p><div className="grid grid-cols-2 gap-3">
            {numberField("cellLengthM", "Largo posición (m)", 0.2, 10)}
            {numberField("cellWidthM", "Ancho posición (m)", 0.2, 10)}
          </div></div>
          <div className="space-y-2">
            <label className="flex min-h-5 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={value.hasRacks} disabled={disabled} className="size-4 accent-teal-700"
              onChange={event => change({ ...value, hasRacks: event.target.checked })} />Esta bodega tiene racks</label>
            {value.hasRacks ? <div className="grid grid-cols-2 gap-3">
              {numberField("rackLevels", "Niveles por rack", 1, 10, 1)}
              {numberField("levelHeightM", "Altura por nivel (m)", 0.1, 20)}
            </div> : <p className="text-sm text-slate-600">Cada cuadro seleccionado será una ubicación de almacenamiento en piso.</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant={tool === "select" ? "default" : "outline"} aria-pressed={tool === "select"} disabled={disabled} onClick={() => setTool("select")}><MousePointer2 className="size-4" /> Marcar</Button>
          <Button type="button" size="sm" variant={tool === "erase" ? "default" : "outline"} aria-pressed={tool === "erase"} disabled={disabled} onClick={() => setTool("erase")}><Eraser className="size-4" /> Borrar</Button>
          <Button type="button" size="sm" variant="ghost" className="ml-auto" disabled={disabled || !value.positions.length} onClick={() => setConfirmClear(true)}>Limpiar selección</Button>
        </div>
        {confirmClear ? <div role="alert" className="flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="grow">¿Quitar todas las posiciones del plano? Se aplicará al guardar.</p>
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setConfirmClear(false)}>Conservar selección</Button>
          <Button type="button" size="sm" disabled={disabled} onClick={() => { change({ ...value, positions: [] }); setConfirmClear(false); }}>Sí, limpiar</Button>
        </div> : null}
        <p className="text-sm text-slate-600">Marca con un clic o arrastra con el mouse. Deja cuadros libres para pasillos. Con teclado, usa Tab y Espacio.</p>
        {!validation.success ? <ul role="alert" className="space-y-1 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {validation.error.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}
        </ul> : null}
        <div className="overflow-auto rounded border border-slate-300 bg-slate-50 p-4">
          {validGrid ? <div style={{ minWidth: Math.max(320, columns * 35) }}>
            <p className="mb-2 text-center text-xs font-medium text-slate-600">← Ancho {value.widthM} m →</p>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs font-medium text-slate-600" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>← Largo {value.lengthM} m →</span>
              <div className="grid grow gap-1 border-2 border-slate-400 bg-white p-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} aria-label="Posiciones de la bodega">
                {Array.from({ length: rows * columns }, (_, index) => {
                  const row = Math.floor(index / columns);
                  const column = index % columns;
                  const selected = positions.has(`${row}:${column}`);
                  const code = positionCode(row, column, value.hasRacks);
                  return <button key={`${row}:${column}`} type="button" disabled={disabled} aria-label={`Posición ${code}`} aria-pressed={selected}
                    title={`${code}${value.hasRacks ? ` · ${value.rackLevels} niveles` : ""}`}
                    className={`min-h-8 min-w-8 select-none rounded-sm border text-[10px] font-medium transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:opacity-50 ${selected ? "border-teal-700 bg-teal-700 text-white hover:bg-teal-800" : "border-slate-200 bg-slate-100 text-slate-500 hover:border-teal-600 hover:bg-teal-50"}`}
                    style={{ aspectRatio: String(value.cellWidthM / value.cellLengthM), maxHeight: 80 }}
                    onPointerDown={event => { ignoreClick.current = false; if (event.pointerType === "mouse" && event.button === 0) { ignoreClick.current = true; paint(row, column); } }}
                    onPointerCancel={() => { ignoreClick.current = false; }}
                    onPointerEnter={event => { if (event.pointerType === "mouse" && event.buttons === 1) paint(row, column); }}
                    onClick={event => { if (event.detail === 0 || !ignoreClick.current) paint(row, column); ignoreClick.current = false; }}>
                    {selected ? `${row + 1}.${column + 1}` : "·"}
                  </button>;
                })}
              </div>
            </div>
            <p className="mt-2 text-right text-xs text-slate-500">{rows} filas × {columns} columnas · {value.hasRacks ? `${value.rackLevels} niveles por posición` : "Almacenamiento en piso"}</p>
          </div> : <p className="py-10 text-center text-sm text-slate-600">Ajusta las dimensiones para mostrar el plano (máximo 20 × 20).</p>}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600"><span className="flex items-center gap-2"><span className="size-3 bg-teal-700" />Ubicación seleccionada</span><span className="flex items-center gap-2"><span className="size-3 border bg-slate-100" />Libre / pasillo</span></div>
        <dl className="grid grid-cols-3 divide-x border-y py-3 text-center">
          <div><dt className="text-xs text-slate-600">Superficie</dt><dd className="text-lg font-semibold tabular-nums">{(value.lengthM * value.widthM).toLocaleString("es-EC", { maximumFractionDigits: 2 })} m²</dd></div>
          <div><dt className="text-xs text-slate-600">Posiciones marcadas</dt><dd className="text-lg font-semibold tabular-nums">{value.positions.length}</dd></div>
          <div><dt className="text-xs text-slate-600">Ubicaciones del plano</dt><dd className="text-lg font-semibold tabular-nums" aria-label="Capacidad del plano">{layoutCapacity(value)}</dd></div>
        </dl>
        <p className="text-xs leading-relaxed text-slate-600">Al guardar se crearán las ubicaciones {value.hasRacks ? "R-01-01-N01, R-01-01-N02… (una por nivel)" : "P-01-01, P-01-02…"}. Las ubicaciones manuales y Cuarentena se conservan. No se pueden quitar ubicaciones con movimientos o existencias.</p>
        <p className="text-xs font-medium text-teal-800">Vista previa. Los cambios se aplican al pulsar Guardar.</p>
      </div>
    </section>
  );
}
