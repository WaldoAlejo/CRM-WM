import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Warehouse } from "./warehouses.types";

// GET /api/warehouses ya incluye `locations` anidadas por bodega (ver
// backend/src/modules/warehouses/warehouses.service.ts::listWarehouses) —
// alcanza un solo fetch tanto para el filtro de bodega en Inventario como
// para armar el selector de ubicación (bodega + código) en Despachos.
export function useWarehouseOptions() {
  return useQuery({
    queryKey: ["warehouses", "options"],
    queryFn: () => apiFetch<Warehouse[]>("/warehouses"),
  });
}
