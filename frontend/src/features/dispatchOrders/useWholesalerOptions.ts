import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Wholesaler } from "@/features/wholesalers/wholesalers.types";

// GET /wholesalers devuelve un array plano sin paginar (dataset chico para
// este negocio) — a diferencia de FinalCustomer, filtrar en el cliente acá
// es razonable y evita tener que agregar ?q= al backend para esto también.
export function useWholesalerOptions(query: string) {
  const { data: all, isLoading } = useQuery({
    queryKey: ["wholesalers", "options"],
    queryFn: () => apiFetch<Wholesaler[]>("/wholesalers"),
  });

  const normalized = query.trim().toLowerCase();
  const filtered =
    !all || normalized.length === 0
      ? []
      : all.filter(
          (w) => w.businessName.toLowerCase().includes(normalized) || w.ruc.includes(normalized)
        );

  return { data: filtered, isLoading };
}
