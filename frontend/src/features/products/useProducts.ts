import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { PaginationMeta } from "@/types/api";
import type { ProductListItem, ProductStatus } from "./products.types";

const PAGE_SIZE = 20;

export interface ProductFilters {
  categoryId?: string;
  subcategoryId?: string;
  status?: ProductStatus;
  brandId?: string;
  q?: string;
}

function buildQuery(page: number, filters: ProductFilters): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.subcategoryId) params.set("subcategoryId", filters.subcategoryId);
  if (filters.status) params.set("status", filters.status);
  if (filters.brandId) params.set("brandId", filters.brandId);
  if (filters.q) params.set("q", filters.q);
  return params.toString();
}

export function useProducts(filters: ProductFilters) {
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ["products", "list", page, filters],
    queryFn: () =>
      apiFetch<{ data: ProductListItem[]; pagination: PaginationMeta }>(
        `/products?${buildQuery(page, filters)}`
      ),
  });

  return { page, setPage, pageSize: PAGE_SIZE, query };
}
