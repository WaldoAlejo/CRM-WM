import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { PaginationMeta } from "@/types/api";
import type { StockByLocationRow } from "./inventory.types";

const PAGE_SIZE = 20;

export function useStockByLocation(warehouseId: string | undefined) {
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (warehouseId) params.set("warehouseId", warehouseId);

  const query = useQuery({
    queryKey: ["inventory", "stock-by-location", page, warehouseId ?? null],
    queryFn: () =>
      apiFetch<{ data: StockByLocationRow[]; pagination: PaginationMeta }>(
        `/inventory/stock-by-location?${params.toString()}`
      ),
  });

  return { page, setPage, pageSize: PAGE_SIZE, query };
}
