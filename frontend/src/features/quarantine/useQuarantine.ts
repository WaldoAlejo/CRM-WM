import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { PaginationMeta } from "@/types/api";
import type { InspectionPayload, InspectionResponse, QuarantineQueueLine } from "./quarantine.types";

const PAGE_SIZE = 20;

export function useQuarantineQueue() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["quarantine", "queue", page],
    queryFn: () =>
      apiFetch<{ data: QuarantineQueueLine[]; pagination: PaginationMeta }>(
        `/quarantine/queue?page=${page}&pageSize=${PAGE_SIZE}`
      ),
  });
  return { page, setPage, query };
}

export function useInspectLine() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ lineId, payload }: { lineId: string; payload: InspectionPayload }) =>
      apiFetch<InspectionResponse>(`/quarantine/lines/${lineId}/inspections`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      // Pasar el checklist reingresa stock; no pasarlo puede generar un cargo/reclamo.
      client.invalidateQueries({ queryKey: ["quarantine"] });
      client.invalidateQueries({ queryKey: ["consignment"] });
      client.invalidateQueries({ queryKey: ["inventory"] });
      client.invalidateQueries({ queryKey: ["accountsReceivable"] });
      client.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
