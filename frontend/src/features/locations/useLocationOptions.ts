import { useWarehouseOptions } from "@/features/warehouses/useWarehouseOptions";

// Lista plana de ubicaciones activas con etiqueta "Bodega · código" (hoy hay
// una sola bodega, pero ya soporta varias sin cambiar el selector). También
// devuelve un mapa id → etiqueta para mostrar la ubicación de un movimiento.
export function useLocationOptions() {
  const query = useWarehouseOptions();
  const options = (query.data ?? []).flatMap((w) =>
    w.locations.map((l) => ({ id: l.id, label: `${w.name} · ${l.code}` }))
  );
  const labelById = new Map(options.map((o) => [o.id, o.label]));
  return { options, labelById, isLoading: query.isLoading };
}
