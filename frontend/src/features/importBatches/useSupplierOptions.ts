import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Supplier } from "@/features/suppliers/suppliers.types";

// pageSize alto a propósito (igual que useCourierOptions): llena un <Select>,
// no una tabla.
export function useSupplierOptions() {
  return useQuery({
    queryKey: ["suppliers", "options"],
    queryFn: () => apiFetch<{ data: Supplier[] }>("/suppliers?pageSize=100").then((res) => res.data),
  });
}
