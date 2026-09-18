import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { CourierRef } from "./dispatchOrders.types";

// pageSize alto a propósito, igual que useBrandOptions: es para llenar un
// <Select> de courier al confirmar una orden CONTRA_ENTREGA, no una tabla.
export function useCourierOptions() {
  return useQuery({
    queryKey: ["couriers", "options"],
    queryFn: () => apiFetch<{ data: CourierRef[] }>("/couriers?pageSize=100").then((res) => res.data),
  });
}
