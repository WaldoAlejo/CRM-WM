import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ProductDetail } from "./products.types";

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: ["products", "detail", id],
    queryFn: () => apiFetch<ProductDetail>(`/products/${id}`),
    enabled: id !== undefined,
  });
}
