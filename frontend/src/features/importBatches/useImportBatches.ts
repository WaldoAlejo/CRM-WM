import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { PaginationMeta } from "@/types/api";
import type { ImportBatchDetail, ImportBatchListItem } from "./importBatches.types";

const PAGE_SIZE = 20;

export function useImportBatches(supplierId: string | undefined) {
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (supplierId) params.set("supplierId", supplierId);

  const query = useQuery({
    queryKey: ["importBatches", "list", page, supplierId ?? null],
    queryFn: () =>
      apiFetch<{ data: ImportBatchListItem[]; pagination: PaginationMeta }>(`/import-batches?${params.toString()}`),
  });

  return { page, setPage, pageSize: PAGE_SIZE, query };
}

export function useImportBatch(id: string | undefined) {
  return useQuery({
    queryKey: ["importBatches", "detail", id],
    queryFn: () => apiFetch<ImportBatchDetail>(`/import-batches/${id}`),
    enabled: !!id,
  });
}
