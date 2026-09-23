import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWarehouseOptions } from "@/features/warehouses/useWarehouseOptions";

interface Props {
  value?: string;
  onChange: (locationId: string | undefined) => void;
  label: string;
  disabled?: boolean;
  required?: boolean;
}

/** Persist only locationId: its warehouse is defined by the location itself. */
export function WarehouseLocationSelect({ value, onChange, label, disabled, required }: Props) {
  const query = useWarehouseOptions();
  const warehouses = (query.data ?? []).filter(w => w.isActive);
  const [chosenWarehouse, setChosenWarehouse] = useState("");
  const owner = warehouses.find(w => w.locations.some(l => l.id === value));
  const warehouseId = owner?.id ?? chosenWarehouse;
  const warehouse = warehouses.find(w => w.id === warehouseId);
  const locations = (warehouse?.locations ?? []).filter(l => l.isActive && l.type !== "CUARENTENA");

  return <div className="min-w-48 space-y-2">
    <Select value={warehouseId || "none"} disabled={disabled || query.isLoading || query.isError}
      onValueChange={id => { setChosenWarehouse(id === "none" ? "" : id); onChange(undefined); }}>
      <SelectTrigger aria-label={`Bodega ${label}`}><SelectValue placeholder="Selecciona una bodega" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Selecciona una bodega</SelectItem>
        {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
      </SelectContent>
    </Select>
    <Select value={locations.some(l => l.id === value) ? value : "none"}
      onValueChange={id => onChange(id === "none" ? undefined : id)}
      disabled={disabled || query.isLoading || query.isError || !warehouse || locations.length === 0}>
      <SelectTrigger aria-label={`Ubicación ${label}`} aria-required={required}><SelectValue placeholder="Selecciona una ubicación" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{required ? "Selecciona una ubicación (obligatoria)" : "Sin especificar"}</SelectItem>
        {locations.map(l => <SelectItem key={l.id} value={l.id}>{warehouse?.name} · {l.code}</SelectItem>)}
      </SelectContent>
    </Select>
    {query.isLoading && <p className="text-xs text-muted-foreground">Cargando bodegas…</p>}
    {query.isError && <p role="alert" className="text-xs text-destructive">No se pudieron cargar las ubicaciones. <button type="button" onClick={() => void query.refetch()}>Reintentar</button></p>}
    {!query.isLoading && !query.isError && warehouses.length === 0 && <p className="text-xs text-muted-foreground">No hay bodegas activas.</p>}
    {warehouse && locations.length === 0 && <p className="text-xs text-muted-foreground">Esta bodega no tiene ubicaciones operativas. Cuarentena se reserva para devoluciones.</p>}
    {warehouse && <a className="text-xs text-primary underline" href={`/catalog/warehouses/${warehouse.id}/locations`} target="_blank" rel="noreferrer">Configurar ubicaciones de esta bodega</a>}
  </div>;
}
