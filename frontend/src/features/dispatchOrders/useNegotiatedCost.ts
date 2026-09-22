import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
export function useNegotiatedCost(variantId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["inventory", "negotiated-cost", variantId],
    queryFn: async () => Number((await apiFetch<{ realCost: string }>(`/dispatch-orders/pricing/${variantId}`)).realCost),
    enabled, retry: false,
  });
}
