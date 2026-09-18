import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Warehouse } from "./warehouses.types";

export function useWarehouse(id: string | undefined) {
  return useQuery({
    queryKey: ["warehouses", id],
    queryFn: () => apiFetch<Warehouse>(`/warehouses/${id}`),
    enabled: !!id,
  });
}
