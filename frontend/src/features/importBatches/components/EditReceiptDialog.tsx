import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { parseDimensions, storageEstimate } from '@/lib/storageVolume';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLocationOptions } from '@/features/locations/useLocationOptions';
import { useWarehouseOptions } from '@/features/warehouses/useWarehouseOptions';
import { locationStorageSpace } from '@/features/warehouses/warehouseSpatialCore';
import type { ImportBatchMovement } from '../importBatches.types';

export function EditReceiptDialog({ batchId, movement, onClose }: { batchId: string; movement: ImportBatchMovement; onClose: () => void }) {
  const [locationId, setLocationId] = useState(movement.toLocationId ?? '');
  const [dimensionsCm, setDimensionsCm] = useState(movement.variant.dimensionsCm ?? '');
  const [maxStackUnits, setMaxStackUnits] = useState(String(movement.variant.maxStackUnits ?? 1));
  const { options, isLoading } = useLocationOptions();
  const { data: warehouses } = useWarehouseOptions();
  const queryClient = useQueryClient();
  const warehouse = warehouses?.find(w => w.locations.some(l => l.id === locationId));
  const location = warehouse?.locations.find(l => l.id === locationId);
  const space = warehouse?.layout && location ? locationStorageSpace(warehouse.layout, location.code) : null;
  const estimate = storageEstimate(dimensionsCm, movement.quantity, Number(maxStackUnits), space?.heightM);
  const valid = (!dimensionsCm.trim() || !!parseDimensions(dimensionsCm)) && Number.isInteger(Number(maxStackUnits)) && Number(maxStackUnits) >= 1 && Number(maxStackUnits) <= 1000;
  const mutation = useMutation({
    mutationFn: () => apiFetch(`/import-batches/${batchId}/movements/${movement.id}`, { method: 'PATCH', body: JSON.stringify({
      locationId: locationId || null,
      ...(dimensionsCm !== (movement.variant.dimensionsCm ?? '') ? { dimensionsCm: dimensionsCm.trim() || null } : {}),
      ...(Number(maxStackUnits) !== (movement.variant.maxStackUnits ?? 1) ? { maxStackUnits: Number(maxStackUnits) } : {}),
    }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      onClose();
    },
  });
  return <Dialog open onOpenChange={open => { if (!open && !mutation.isPending) onClose(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Editar ubicación y dimensiones</DialogTitle><DialogDescription>{movement.variant.sku} · {movement.quantity} unidades recibidas</DialogDescription></DialogHeader>
      <form onSubmit={event => { event.preventDefault(); if (valid) mutation.mutate(); }} className="space-y-4">
        <fieldset disabled={mutation.isPending} className="space-y-4">
          <label className="grid gap-2 text-sm font-medium">Ubicación del ingreso
            <select className="h-10 rounded-md border bg-background px-3" value={locationId} disabled={isLoading} onChange={e => setLocationId(e.target.value)}>
              <option value="">Sin ubicación</option>
              {movement.toLocationId && !options.some(o => o.id === movement.toLocationId) && <option value={movement.toLocationId}>Ubicación anterior (inactiva)</option>}
              {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">Dimensiones del empaque por unidad (cm)
            <Input placeholder="Largo x ancho x alto; ej. 50x40x30" value={dimensionsCm} onChange={e => setDimensionsCm(e.target.value)} />
          </label>
          <label className="grid gap-2 text-sm font-medium">Máximo de unidades por pila (incluye la base)
            <Input type="number" min={1} max={1000} step={1} required value={maxStackUnits} onChange={e => setMaxStackUnits(e.target.value)} />
          </label>
          <p className="text-xs text-muted-foreground">1 = no apilable. Dimensiones y apilamiento se actualizan para esta variante en todo el inventario. Los CBM facturados de la importación y sus costos se conservan.</p>
          {!valid && <p role="alert" className="text-sm text-destructive">Ingresa tres dimensiones positivas y un máximo de pila entero entre 1 y 1000.</p>}
          {estimate && <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
            <p>Volumen por unidad: {estimate.unitCbm.toFixed(6)} m³</p>
            <p>Volumen de {movement.quantity} unidades: {estimate.totalCbm.toFixed(6)} m³</p>
            <p>Apilamiento permitido{space ? ' según altura disponible' : ''}: {estimate.layers} unidades por pila</p>
            <p>Superficie mínima estimada: {estimate.floorAreaM2?.toFixed(3) ?? 'No cabe en altura'} m²</p>
            {space && <p>Capacidad geométrica de la ubicación: {(space.areaM2 * space.heightM).toFixed(3)} m³ · altura {space.heightM} m</p>}
            {space && (estimate.layers === 0 || (estimate.floorAreaM2 ?? 0) > space.areaM2) && <p className="text-amber-700">Esta cantidad supera el espacio estimado de la ubicación.</p>}
            <p className="text-xs text-muted-foreground">Estimación de este ingreso; no descuenta otras existencias ni pasillos de maniobra. La distribución real también depende de cómo encajen los empaques.</p>
          </div>}
        </fieldset>
        {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>Cancelar</Button><Button type="submit" disabled={mutation.isPending || isLoading || !valid}>{mutation.isPending ? 'Guardando…' : 'Guardar cambios'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
