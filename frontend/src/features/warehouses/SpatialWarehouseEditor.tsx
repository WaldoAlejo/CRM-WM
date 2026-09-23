import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { spatialMetrics, polygonContainsPolygon, rectanglePolygon, rectanglesOverlap, permitsOverlap } from "./warehouseSpatialCore";
import type { Point, SpatialElement, SpatialLayout, StorageElement } from "./warehouseSpatialCore";
import { spatialLayoutSchema } from "./warehouseSpatial.schemas";

const labels: Record<SpatialElement["type"], string> = { STORAGE: "Ubicación", WALL: "Pared", DOOR: "Puerta", WINDOW: "Ventana", DESK: "Escritorio", DISPATCH: "Mesa de despacho", WORK: "Área de trabajo", COLUMN: "Columna", AISLE: "Pasillo", EXCLUDED: "Área no utilizable" };
const colors: Record<SpatialElement["type"], string> = { STORAGE: "#0f766e", WALL: "#475569", DOOR: "#0284c7", WINDOW: "#38bdf8", DESK: "#b45309", DISPATCH: "#d97706", WORK: "#fbbf24", COLUMN: "#64748b", AISLE: "#cbd5e1", EXCLUDED: "#94a3b8" };
const round = (n: number) => Math.round(n * 10) / 10;
function NumberField({ label, value, onChange, min = 0, max = 200, step = .1 }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  return <label className="grid gap-1 text-xs font-medium text-slate-700">{label}<Input type="number" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="h-8 bg-white" /></label>;
}

export function SpatialWarehouseEditor({ value, onChange, disabled = false }: { value: SpatialLayout; onChange: (value: SpatialLayout) => void; disabled?: boolean }) {
  const [selectedId, setSelectedId] = useState<string>();
  const [focusedId, setFocusedId] = useState<string>();
  const [past, setPast] = useState<SpatialLayout[]>([]);
  const [future, setFuture] = useState<SpatialLayout[]>([]);
  const [drawing, setDrawing] = useState<Point[] | null>(null);
  const [zoom, setZoom] = useState(1);
  const [addType, setAddType] = useState<SpatialElement["type"]>("STORAGE");
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ start: Point; element: SpatialElement; original: SpatialLayout; moved: boolean } | null>(null);
  const selected = value.elements.find(e => e.id === selectedId);
  const metrics = spatialMetrics(value);
  const parsed = spatialLayoutSchema.safeParse(value);
  const errors = parsed.success ? [] : [...new Set(parsed.error.issues.map(issue => {
    if (issue.code === "custom") return issue.message;
    const field = issue.path.at(-1);
    const element = issue.path[0] === "elements" ? value.elements[Number(issue.path[1])] : undefined;
    const prefix = element ? `${element.name || "Espacio"}: ` : "";
    if (field === "slots") return `${prefix}selecciona al menos un pallet (máximo 400).`;
    if (field === "levels") return `${prefix}ingresa entre 1 y 50 niveles enteros.`;
    if (field === "name") return "Cada espacio necesita un nombre de hasta 80 caracteres.";
    if (field === "code") return `${prefix}usa un código de hasta 40 letras, números, guiones o guiones bajos.`;
    if (field === "elements") return "El plano admite hasta 150 espacios.";
    if (field === "boundary") return "El contorno admite entre 3 y 64 vértices.";
    return `${prefix}revisa las medidas: deben ser positivas y estar dentro de los límites indicados.`;
  }))];
  const maxX = Math.max(5, ...value.boundary.map(p => p.x));
  const maxY = Math.max(5, ...value.boundary.map(p => p.y));
  const format = (n: number) => n.toLocaleString("es-EC", { maximumFractionDigits: 1 });
  function commit(next: SpatialLayout) { setPast(p => [...p.slice(-39), value]); setFuture([]); onChange(next); }
  function updateElement(patch: Partial<SpatialElement> | Partial<StorageElement>) { if (selected) commit({ ...value, elements: value.elements.map(e => e.id === selected.id ? { ...e, ...patch } as SpatialElement : e) }); }
  function coordinate(event: PointerEvent<SVGSVGElement>): Point {
    const node = svg.current!; const point = node.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const local = point.matrixTransform(node.getScreenCTM()!.inverse()); return { x: Math.max(0, round(local.x)), y: Math.max(0, round(local.y)) };
  }
  function addElement() {
    let n = 1; while (value.elements.some(e => e.name === `${labels[addType]} ${n}` || (e.type === "STORAGE" && e.code === `UB-${n}`))) n++;
    const base = { id: crypto.randomUUID(), type: addType, name: `${labels[addType]} ${n}`, x: 1, y: 1, width: 2.4, depth: 1, rotation: 0 };
    const element: SpatialElement = addType === "STORAGE" ? { ...base, type: "STORAGE", code: `UB-${n}`, mode: "FLOOR", palletWidthM: 1.2, palletDepthM: 1, gapM: 0, levels: 1, levelHeightM: 1.5, slots: [{ row: 0, column: 0 }, { row: 0, column: 1 }], intendedUse: "" } : { ...base, width: addType === "COLUMN" ? .4 : addType === "WALL" ? 3 : 1.2, depth: addType === "WALL" || addType === "WINDOW" ? .2 : addType === "COLUMN" ? .4 : addType === "DESK" ? .6 : 1.2 } as SpatialElement;
    // Find a clear footprint; if none fits, preserve the editable draft and show validation.
    let found = false, attempts = 0;
    const existing = value.elements.map(item => ({ item, polygon: rectanglePolygon(item) }));
    for (let y = .5; y < maxY && !found && attempts < 400; y += .5) for (let x = .5; x < maxX && !found && attempts < 400; x += .5) {
      attempts++;
      element.x = x; element.y = y;
      const polygon = rectanglePolygon(element);
      if (polygonContainsPolygon(value.boundary, polygon) && !existing.some(({ item, polygon: other }) => {
        if (permitsOverlap(element, item)) return false;
        return rectanglesOverlap(polygon, other);
      })) found = true;
    }
    if (!found) { element.x = 1; element.y = 1; }
    commit({ ...value, elements: [...value.elements, element] }); setSelectedId(element.id);
  }
  function undo() { const previous = past.at(-1); if (previous) { setPast(past.slice(0, -1)); setFuture([value, ...future]); onChange(previous); } }
  function redo() { const next = future[0]; if (next) { setFuture(future.slice(1)); setPast([...past, value]); onChange(next); } }
  const selectedStorage = selected?.type === "STORAGE" ? selected : undefined;
  const rows = selectedStorage ? Math.max(0, Math.min(20, Math.floor((selectedStorage.depth + selectedStorage.gapM) / (selectedStorage.palletDepthM + selectedStorage.gapM) + 1e-8))) : 0;
  const columns = selectedStorage ? Math.max(0, Math.min(20, Math.floor((selectedStorage.width + selectedStorage.gapM) / (selectedStorage.palletWidthM + selectedStorage.gapM) + 1e-8))) : 0;
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-widest text-teal-800">Plano de espacios</p><h3 className="text-lg font-semibold text-slate-900">Cada espacio, en su lugar</h3><p className="text-xs text-slate-600">Dibuja el contorno, organiza zonas y reserva la circulación.</p></div><div className="flex gap-1"><Button type="button" size="sm" variant="outline" disabled={disabled || !past.length} onClick={undo}>Deshacer</Button><Button type="button" size="sm" variant="outline" disabled={disabled || !future.length} onClick={redo}>Rehacer</Button></div></div>
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-slate-200 sm:grid-cols-4">{[["Superficie útil", `${format(metrics.usableAreaM2)} m²`], ["Libre para organizar", `${format(metrics.freeAreaM2)} m²`], ["Posiciones de pallet", metrics.palletCapacity], ["Ubicaciones", metrics.locationCount]].map(([label, count]) => <div key={label} className="bg-slate-50 px-3 py-2"><p className="text-[11px] text-slate-600">{label}</p><p className="text-lg font-semibold tabular-nums text-slate-900">{count}</p></div>)}</div>
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-white p-2"><select aria-label="Elemento para agregar" className="h-8 max-w-full rounded border bg-white px-2 text-sm" value={addType} onChange={e => setAddType(e.target.value as SpatialElement["type"])}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><Button type="button" size="sm" onClick={addElement}>Agregar al plano</Button><span className="flex-1" /><Button type="button" size="sm" variant={drawing ? "default" : "outline"} onClick={() => setDrawing(drawing ? null : [])}>Dibujar contorno</Button><label className="flex items-center gap-1 text-xs">Zoom<select aria-label="Zoom del plano" className="h-8 rounded border" value={zoom} onChange={e => setZoom(Number(e.target.value))}><option value={1}>100%</option><option value={1.5}>150%</option><option value={2}>200%</option><option value={3}>300%</option></select></label></div>
    {drawing && <div className="flex flex-wrap items-center gap-2 rounded border border-blue-200 bg-blue-50 p-2 text-sm text-blue-900"><span>Haz clic en cada esquina del perímetro ({drawing.length} puntos).</span><Button type="button" size="sm" disabled={drawing.length < 3} onClick={() => { commit({ ...value, boundary: drawing }); setDrawing(null); }}>Cerrar contorno</Button><Button type="button" size="sm" variant="outline" onClick={() => setDrawing(null)}>Cancelar dibujo</Button></div>}
    <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_250px]">
      <div className="min-w-0 space-y-2"><div className="overflow-auto rounded-md border border-slate-300 bg-slate-100" style={{ maxHeight: 570 }}>
        <svg ref={svg} role="img" aria-label="Plano de la bodega en metros" viewBox={`-1 -1 ${maxX + 2} ${maxY + 2}`} style={{ width: `${zoom * 100}%`, minWidth: 420, minHeight: 360, aspectRatio: `${maxX + 2}/${maxY + 2}`, touchAction: "none", cursor: drawing ? "crosshair" : "default" }} onPointerDown={event => { if (disabled) return; if (drawing) setDrawing([...drawing, coordinate(event)]); else if (event.target === svg.current) setSelectedId(undefined); }} onPointerMove={event => { if (!drag.current || disabled) return; const p = coordinate(event); const d = drag.current; d.moved = true; onChange({ ...d.original, elements: d.original.elements.map(e => e.id === d.element.id ? { ...e, x: Math.max(0, round(d.element.x + p.x - d.start.x)), y: Math.max(0, round(d.element.y + p.y - d.start.y)) } : e) }); }} onPointerUp={() => { if (drag.current?.moved) { const original = drag.current.original; setPast(p => [...p.slice(-39), original]); setFuture([]); } drag.current = null; }} onPointerCancel={() => { if (drag.current) onChange(drag.current.original); drag.current = null; }}>
          <defs><pattern id="wm-meter-grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1" fill="none" stroke="#cbd5e1" strokeWidth=".015" /></pattern><pattern id="wm-excluded" width=".3" height=".3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" x2="0" y1="0" y2=".3" stroke="#64748b" strokeWidth=".04" /></pattern></defs>
          <polygon points={value.boundary.map(p => `${p.x},${p.y}`).join(" ")} fill="white" stroke="#334155" strokeWidth=".07" /><polygon points={value.boundary.map(p => `${p.x},${p.y}`).join(" ")} fill="url(#wm-meter-grid)" pointerEvents="none" />
          {value.elements.map(element => <g key={element.id} role="button" tabIndex={disabled ? -1 : 0} aria-label={`Seleccionar ${element.name}`} aria-pressed={selectedId === element.id} onFocus={() => { if (!disabled) setFocusedId(element.id); }} onBlur={() => setFocusedId(undefined)} onKeyDown={e => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setSelectedId(element.id); } }} onPointerDown={event => { if (disabled || drawing) return; event.stopPropagation(); setSelectedId(element.id); drag.current = { start: coordinate(event as unknown as PointerEvent<SVGSVGElement>), element, original: value, moved: false }; svg.current?.setPointerCapture(event.pointerId); }} transform={`translate(${element.x} ${element.y}) rotate(${element.rotation})`} style={{ cursor: drawing ? "crosshair" : "move", outline: "none" }}>
            <rect width={element.width} height={element.depth} fill={element.type === "EXCLUDED" ? "url(#wm-excluded)" : colors[element.type]} fillOpacity={element.type === "WALL" || element.type === "COLUMN" ? 1 : .18} stroke={selectedId === element.id ? "#0f172a" : colors[element.type]} strokeWidth={selectedId === element.id ? .065 : .035} strokeDasharray={element.type === "AISLE" || element.type === "WORK" ? ".12 .08" : undefined} />
            {element.type === "STORAGE" && element.slots.map(slot => <g key={`${slot.row}:${slot.column}`} transform={`translate(${slot.column * (element.palletWidthM + element.gapM)} ${slot.row * (element.palletDepthM + element.gapM)})`}><rect x=".04" y=".04" width={Math.max(.05, element.palletWidthM - .08)} height={Math.max(.05, element.palletDepthM - .08)} rx=".025" fill={element.mode === "RACK" ? "#7c3aed" : element.mode === "STACK" ? "#0369a1" : "#0f766e"} fillOpacity=".35" stroke={element.mode === "RACK" ? "#7c3aed" : "#0f766e"} strokeWidth=".025" /><path d={`M .12 ${element.palletDepthM * .3} h ${Math.max(0, element.palletWidthM - .24)} M .12 ${element.palletDepthM * .7} h ${Math.max(0, element.palletWidthM - .24)}`} stroke="white" strokeWidth=".035" /></g>)}
            {element.type === "DOOR" && <path d={`M 0 0 L ${element.width} 0 A ${element.width} ${element.depth} 0 0 1 0 ${element.depth} Z`} fill="none" stroke="#0284c7" strokeWidth=".04" strokeDasharray=".1 .05" />}
            {element.type === "WINDOW" && <path d={`M 0 ${element.depth / 2} H ${element.width}`} stroke="#0284c7" strokeWidth=".055" />}
            <text x=".08" y={Math.min(.3, element.depth / 2)} fontSize=".22" fontWeight="600" fill="#0f172a" paintOrder="stroke" stroke="white" strokeWidth=".04">{element.name}{element.type === "STORAGE" && element.levels > 1 ? ` · ${element.levels} niveles` : ""}</text>
            {/* Native SVG focus outlines scale in metres; keep keyboard focus in screen pixels. */}
            {!disabled && focusedId === element.id && <rect data-focus-ring="true" x="-.04" y="-.04" width={element.width + .08} height={element.depth + .08} fill="none" stroke="#2563eb" strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none" aria-hidden="true" />}
          </g>)}
          {drawing && <><polyline points={drawing.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#0284c7" strokeWidth=".07" />{drawing.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r=".12" fill="#0284c7" />)}</>}
          <text x={maxX / 2} y="-.35" textAnchor="middle" fontSize=".25" fill="#475569">{format(maxX)} m</text><text x="-.35" y={maxY / 2} textAnchor="middle" fontSize=".25" fill="#475569" transform={`rotate(-90 -.35 ${maxY / 2})`}>{format(maxY)} m</text>
        </svg>
      </div><p className="text-xs text-slate-600">Cuadrícula: 1 m · Arrastra para mover · Ajuste: 0,1 m · Selecciona un objeto para editarlo.</p><div className="flex flex-wrap gap-3 text-[11px] text-slate-600"><span>🟩 Piso</span><span>🟦 Apilado</span><span>🟪 Racks</span><span>Ámbar: trabajo</span><span>Gris: estructura / circulación</span></div></div>
      <aside className="min-w-0 space-y-3 rounded-md border bg-slate-50 p-3">
        <div className="flex items-center justify-between"><h4 className="text-sm font-semibold">{selected ? "Editar espacio" : "Espacios del plano"}</h4>{selected && <button type="button" className="text-xs text-teal-800 underline" onClick={() => setSelectedId(undefined)}>Ver todos</button>}</div>
        {!selected ? <><p className="text-xs text-slate-600">Agrega una ubicación y selecciona los pallets que pertenecen a ella.</p><div className="max-h-72 space-y-1 overflow-y-auto">{value.elements.map(e => <button type="button" key={e.id} onClick={() => setSelectedId(e.id)} className="flex w-full items-center gap-2 rounded border bg-white px-2 py-2 text-left text-xs hover:border-teal-600"><span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: colors[e.type] }} /><span className="truncate">{e.name}</span><span className="ml-auto text-slate-500">{labels[e.type]}</span></button>)}{!value.elements.length && <div className="border border-dashed p-4 text-center text-xs text-slate-500">Tu plano está listo para organizar. Empieza por una ubicación o una pared.</div>}</div></> : <>
          <label className="grid gap-1 text-xs font-medium">Nombre<Input value={selected.name} maxLength={80} onChange={e => updateElement({ name: e.target.value })} /></label>
          {selected.type === "WORK" && <p className="text-xs text-slate-600">Puedes colocar escritorios y mesas completamente dentro de esta área. Su superficie se cuenta una sola vez.</p>}
          {selected.type === "DOOR" && <p className="text-xs text-slate-600">Reserva el espacio de apertura y circulación. Puede conectar una pared con un pasillo o área de trabajo.</p>}
          <div className="grid grid-cols-2 gap-2"><NumberField label="X (m)" value={selected.x} onChange={x => updateElement({ x })} /><NumberField label="Y (m)" value={selected.y} onChange={y => updateElement({ y })} /><NumberField label="Ancho (m)" min={.1} value={selected.width} onChange={width => updateElement({ width })} /><NumberField label="Fondo (m)" min={.1} value={selected.depth} onChange={depth => updateElement({ depth })} /></div><NumberField label="Giro (°)" min={-360} max={360} step={1} value={selected.rotation} onChange={rotation => updateElement({ rotation })} />
          {selectedStorage && <div className="space-y-3 border-t pt-3">
            <label className="grid gap-1 text-xs font-medium">Código de ubicación<Input value={selectedStorage.code} maxLength={40} onChange={e => updateElement({ code: e.target.value })} /></label>
            <label className="grid gap-1 text-xs font-medium">Organización<select className="h-9 rounded border bg-white px-2" value={selectedStorage.mode} onChange={e => updateElement({ mode: e.target.value as StorageElement["mode"], levels: e.target.value === "FLOOR" ? 1 : Math.max(2, selectedStorage.levels) })}><option value="FLOOR">Al piso · ubicación agrupada</option><option value="STACK">Apilado · ubicación por nivel</option><option value="RACK">Rack · posición y nivel</option></select></label>
            <div className="grid grid-cols-2 gap-2"><NumberField label="Niveles" min={1} max={50} step={1} value={selectedStorage.levels} onChange={levels => updateElement({ levels: selectedStorage.mode === "FLOOR" ? 1 : levels })} /><NumberField label="Altura / nivel (m)" min={.1} max={20} value={selectedStorage.levelHeightM} onChange={levelHeightM => updateElement({ levelHeightM })} /></div>
            <label className="grid gap-1 text-xs font-medium">Formato de pallet<select aria-label="Formato de pallet" className="h-9 rounded border bg-white px-2" value={selectedStorage.palletWidthM === 1.2 && selectedStorage.palletDepthM === 1 ? "industrial" : selectedStorage.palletWidthM === 1.2 && selectedStorage.palletDepthM === .8 ? "euro" : "custom"} onChange={e => { if (e.target.value !== "custom") updateElement({ palletWidthM: 1.2, palletDepthM: e.target.value === "euro" ? .8 : 1 }); }}><option value="industrial">EPAL 3 · 1,20 × 1,00 m</option><option value="euro">EPAL Euro · 1,20 × 0,80 m</option><option value="custom">Personalizado</option></select></label>
            <div className="grid grid-cols-2 gap-2"><NumberField label="Pallet ancho (m)" min={.2} max={10} value={selectedStorage.palletWidthM} onChange={palletWidthM => updateElement({ palletWidthM })} /><NumberField label="Pallet fondo (m)" min={.2} max={10} value={selectedStorage.palletDepthM} onChange={palletDepthM => updateElement({ palletDepthM })} /></div><NumberField label="Separación entre pallets (m)" max={2} value={selectedStorage.gapM} onChange={gapM => updateElement({ gapM })} />
            <div><p className="mb-2 text-xs font-medium">Pallets de esta ubicación ({selectedStorage.slots.length})</p><div className="max-h-40 overflow-auto"><div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(28px, 1fr))` }}>{Array.from({ length: rows * columns }, (_, i) => { const row = Math.floor(i / columns), column = i % columns; const active = selectedStorage.slots.some(s => s.row === row && s.column === column); return <button type="button" key={i} aria-label={`Pallet fila ${row + 1} columna ${column + 1}`} aria-pressed={active} onClick={() => updateElement({ slots: active ? selectedStorage.slots.filter(s => s.row !== row || s.column !== column) : [...selectedStorage.slots, { row, column }] })} className={`h-8 rounded border text-[10px] ${active ? "border-teal-800 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{row + 1}.{column + 1}</button>; })}</div></div><p className="mt-1 text-[11px] text-slate-500">Marca las posiciones que comparten esta ubicación. Al piso se guardan con un solo código.</p></div>
            <label className="grid gap-1 text-xs font-medium">Uso previsto<Input value={selectedStorage.intendedUse ?? ""} maxLength={200} placeholder="Ej. Power stations" onChange={e => updateElement({ intendedUse: e.target.value })} /></label>
          </div>}
          <Button type="button" size="sm" variant="outline" className="w-full text-red-700" onClick={() => { commit({ ...value, elements: value.elements.filter(e => e.id !== selected.id) }); setSelectedId(undefined); }}>Quitar espacio</Button>
        </>}
      </aside>
    </div>
    <details className="rounded-md border bg-white p-3"><summary className="cursor-pointer text-sm font-medium">Dimensiones y contorno de la bodega</summary><div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr]"><NumberField label="Altura libre (m)" min={.1} max={100} value={value.heightM} onChange={heightM => commit({ ...value, heightM })} /><div><div className="mb-2 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => commit({ ...value, boundary: [{ x: 0, y: 0 }, { x: maxX, y: 0 }, { x: maxX, y: maxY }, { x: 0, y: maxY }] })}>Contorno rectangular</Button><Button type="button" size="sm" variant="outline" onClick={() => commit({ ...value, boundary: [{ x: 0, y: 0 }, { x: maxX, y: 0 }, { x: maxX, y: round(maxY * .6) }, { x: round(maxX * .6), y: round(maxY * .6) }, { x: round(maxX * .6), y: maxY }, { x: 0, y: maxY }] })}>Contorno en L</Button></div><p className="text-xs text-slate-600">Edita cada vértice en metros para incluir diagonales y divisiones. El dibujo nuevo sustituye solo el perímetro.</p><div className="mt-2 grid max-h-44 gap-2 overflow-auto sm:grid-cols-2">{value.boundary.map((p, i) => <div key={i} className="grid grid-cols-[20px_1fr_1fr] items-end gap-1"><span className="pb-2 text-xs">{i + 1}</span><NumberField label={`Vértice ${i + 1} X`} value={p.x} onChange={x => commit({ ...value, boundary: value.boundary.map((v, j) => j === i ? { ...v, x } : v) })} /><NumberField label={`Vértice ${i + 1} Y`} value={p.y} onChange={y => commit({ ...value, boundary: value.boundary.map((v, j) => j === i ? { ...v, y } : v) })} /></div>)}</div></div></div></details>
    {errors.length > 0 && <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800"><p className="mb-1 font-semibold">Ajusta el plano antes de guardar</p>{errors.slice(0, 8).map((error, i) => <p key={i}>• {error}</p>)}{errors.length > 8 && <p>Y {errors.length - 8} observaciones más.</p>}</div>}
    <p className="text-[11px] leading-relaxed text-slate-500">Capacidad de diseño; no representa existencias ni valida resistencia de racks. Considera maniobra, evacuación y cargas con el responsable técnico. <a href="https://www.epal-pallets.org/eu-en/media-centre/product-sheets" target="_blank" rel="noreferrer" className="underline">Formatos EPAL</a>.</p>
  </fieldset>;
}
