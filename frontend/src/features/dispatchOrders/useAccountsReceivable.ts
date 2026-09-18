import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { PaginationMeta } from "@/types/api";
import type { AccountsReceivableItem } from "./dispatchOrders.types";

const PAGE_SIZE = 20;

export function useAccountsReceivable() {
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ["accountsReceivable", "list", page],
    queryFn: () =>
      apiFetch<{ data: AccountsReceivableItem[]; pagination: PaginationMeta }>(
        `/accounts-receivable?page=${page}&pageSize=${PAGE_SIZE}`
      ),
  });

  return { page, setPage, pageSize: PAGE_SIZE, query };
}
