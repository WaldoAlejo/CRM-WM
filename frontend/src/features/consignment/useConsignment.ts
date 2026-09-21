import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { PaginationMeta } from "@/types/api";
import type {
  ConsignmentLotDetail,
  ConsignmentLotListItem,
  CreateConsignmentLotPayload,
  CreateReviewPayload,
} from "./consignment.types";

const PAGE_SIZE = 20;

export function useConsignmentLots(overdueOnly: boolean) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["consignment", "lots", page, overdueOnly],
    queryFn: () =>
      apiFetch<{ data: ConsignmentLotListItem[]; pagination: PaginationMeta }>(
        `/consignment/lots?page=${page}&pageSize=${PAGE_SIZE}${overdueOnly ? "&overdue=true" : ""}`
      ),
  });
  return { page, setPage, query };
}

export function useConsignmentLot(id: string | undefined) {
  return useQuery({
    queryKey: ["consignment", "lot", id],
    queryFn: () => apiFetch<ConsignmentLotDetail>(`/consignment/lots/${id}`),
    enabled: !!id,
  });
}

export function useCreateConsignmentLot() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateConsignmentLotPayload) =>
      apiFetch<ConsignmentLotDetail>("/consignment/lots", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["consignment"] }),
  });
}

export function useCreateReview(lotId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateReviewPayload) =>
      apiFetch<{ lot: ConsignmentLotDetail }>(`/consignment/lots/${lotId}/reviews`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      // Una liquidación cambia lotes, cartera (nuevo cargo), cola de Cuarentena y Dashboard.
      client.invalidateQueries({ queryKey: ["consignment"] });
      client.invalidateQueries({ queryKey: ["quarantine"] });
      client.invalidateQueries({ queryKey: ["accountsReceivable"] });
      client.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
