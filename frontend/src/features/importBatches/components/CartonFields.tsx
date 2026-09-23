import { Input } from '@/components/ui/input';
import { cartonPlan, type CartonPackaging } from '@/lib/cartonPackaging';
import { cartonPackagingSchema } from '../cartonPackaging.schema';

export function CartonPlanSummary({ packaging, volumeCbm, heightM }: { packaging: CartonPackaging; volumeCbm: number | null; heightM?: number }) {
  const plan = cartonPlan(packaging, volumeCbm, heightM);
  if (!plan) return null;
  return <div className="space-y-1 rounded border bg-muted/30 p-3 text-sm">
    <p>{plan.cartonCount} cartones · {plan.totalUnits} unidades · {plan.totalCbm ?? '—'} m³ informados</p>
    <p>CBM promedio por cartón: {plan.cbmPerCarton?.toFixed(6) ?? '—'}</p>
    <p>{plan.piles === null ? 'El cartón no cabe en la altura disponible' : `${plan.piles} pilas de hasta ${plan.layers} cartones`}</p>
    <p>{plan.stackingConfirmed ? 'Apilamiento confirmado' : 'Apilamiento provisional · pendiente de confirmar'}</p>
    <p>Superficie mínima estimada: {plan.floorAreaM2 === null ? 'Pendiente de medidas / altura disponible' : `${plan.floorAreaM2.toFixed(3)} m²`}</p>
    {plan.stackHeightM !== null && <p>Altura de pila: {plan.stackHeightM.toFixed(3)} m</p>}
    {plan.measuredCbm !== null && <p>Volumen según medidas: {plan.measuredCbm.toFixed(6)} m³. No reemplaza los CBM informados para costos.</p>}
    <p className="text-xs text-muted-foreground">Plan de los cartones recibidos, no existencias restantes. Las pilas no equivalen a pallets; se requiere comprobar el encaje y reservar circulación.{!plan.heightChecked ? ' Altura de ubicación sin verificar.' : ''}</p>
  </div>;
}

export function CartonFields({ value, onChange, volumeCbm, heightM, label = '' }: {
  value: CartonPackaging | undefined; onChange: (value: CartonPackaging | undefined) => void;
  volumeCbm: number | null; heightM?: number; label?: string;
}) {
  return <div className="min-w-64 space-y-3">
    <label className="flex gap-2 text-sm font-medium"><input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked ? { cartonCount: 0, unitsPerCarton: 0, maxStackCartons: 3, stackingConfirmed: false } : undefined)} />Registrar cartones{label ? ` · ${label}` : ''}</label>
    {value && <>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">Cartones<Input aria-label={`Cartones ${label}`.trim()} type="number" min={1} max={1000000} step={1} value={value.cartonCount || ''} onChange={e => onChange({ ...value, cartonCount: Number(e.target.value) })} /></label>
        <label className="text-xs">Unidades por cartón<Input aria-label={`Unidades por cartón ${label}`.trim()} type="number" min={1} max={1000000} step={1} value={value.unitsPerCarton || ''} onChange={e => onChange({ ...value, unitsPerCarton: Number(e.target.value) })} /></label>
      </div>
      <label className="grid gap-1 text-xs">Máximo de cartones por pila (incluye la base)<Input aria-label={`Máximo de cartones por pila ${label}`.trim()} type="number" min={1} max={1000} step={1} value={value.maxStackCartons || ''} onChange={e => onChange({ ...value, maxStackCartons: Number(e.target.value), stackingConfirmed: false })} /></label>
      <label className="flex gap-2 text-xs"><input type="checkbox" checked={value.stackingConfirmed} onChange={e => onChange({ ...value, stackingConfirmed: e.target.checked })} />Límite de apilamiento confirmado</label>
      <label className="grid gap-1 text-xs">Dimensiones del cartón (cm, opcionales)<Input aria-label={`Dimensiones del cartón ${label}`.trim()} placeholder="Largo x ancho x alto" value={value.cartonDimensionsCm ?? ''} onChange={e => onChange({ ...value, cartonDimensionsCm: e.target.value || null })} /></label>
      {!cartonPackagingSchema.safeParse(value).success && <p className="text-xs text-destructive" role="alert">Completa cantidades enteras positivas y un apilamiento entre 1 y 1000. Si agregas medidas, usa largo x ancho x alto positivos.</p>}
      <CartonPlanSummary packaging={value} volumeCbm={volumeCbm} heightM={heightM} />
    </>}
  </div>;
}
