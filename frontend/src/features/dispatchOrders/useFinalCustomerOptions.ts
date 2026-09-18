import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { FinalCustomer } from "@/features/finalCustomers/finalCustomers.types";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

// A diferencia de Wholesaler (lista chica, se filtra en el cliente), esta
// lista está paginada desde el diseño original del backend — se busca del
// lado del servidor con ?q=, debounced para no mandar un request por tecla.
export function useFinalCustomerOptions(query: string) {
  const debounced = useDebouncedValue(query, 300);
  const trimmed = debounced.trim();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["finalCustomers", "options", trimmed],
    queryFn: () =>
      apiFetch<{ data: FinalCustomer[] }>(`/final-customers?q=${encodeURIComponent(trimmed)}&pageSize=20`).then(
        (res) => res.data
      ),
    enabled: trimmed.length > 0,
  });

  return { data: trimmed.length > 0 ? (data ?? []) : [], isLoading: isLoading || isFetching };
}
