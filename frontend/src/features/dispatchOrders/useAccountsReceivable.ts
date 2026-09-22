import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { PaginationMeta } from "@/types/api";
import type { AccountsReceivableItem, CollectionStatus } from "./dispatchOrders.types";

const PAGE_SIZE = 20;

// Sin filtro el backend devuelve solo las VENCIDAS (el listado de siempre).
export type ReceivableFilter = CollectionStatus | "TODAS";

export function useAccountsReceivable(status: ReceivableFilter = "VENCIDO") {
  const [page, setPage] = useState(1);

  // Al cambiar de filtro se vuelve a la primera página.
  useEffect(() => {
    setPage(1);
  }, [status]);

  const query = useQuery({
    queryKey: ["accountsReceivable", "list", status, page],
    queryFn: () =>
      apiFetch<{ data: AccountsReceivableItem[]; pagination: PaginationMeta }>(
        `/accounts-receivable?page=${page}&pageSize=${PAGE_SIZE}&status=${status}`
      ),
  });

  return { page, setPage, pageSize: PAGE_SIZE, query };
}
