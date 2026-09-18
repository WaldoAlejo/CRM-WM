import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { PaginationMeta } from "@/types/api";
import type { StockSummaryRow } from "./inventory.types";

const PAGE_SIZE = 20;

// GET /inventory/stock-summary?belowMinStock=true — mismo endpoint que ya
// usa el Dashboard para el top-5, acá es el listado completo al que apunta
// "Ver todos".
export function useLowStock() {
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ["inventory", "stock-summary", "low-stock", page],
    queryFn: () =>
      apiFetch<{ data: StockSummaryRow[]; pagination: PaginationMeta }>(
        `/inventory/stock-summary?belowMinStock=true&page=${page}&pageSize=${PAGE_SIZE}`
      ),
  });

  return { page, setPage, pageSize: PAGE_SIZE, query };
}
