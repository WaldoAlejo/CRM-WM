import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { DispatchOrderDetail } from "./dispatchOrders.types";

export function useDispatchOrder(id: string | undefined) {
  return useQuery({
    queryKey: ["dispatchOrders", "detail", id],
    queryFn: () => apiFetch<DispatchOrderDetail>(`/dispatch-orders/${id}`),
    enabled: id !== undefined,
  });
}
