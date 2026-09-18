import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ClaimStatus, ResolveCustomerResult } from "./insuranceClaims.types";

interface ResolveCustomerPayload {
  resolution: "REPLACEMENT" | "REFUND";
  refundAmount?: number;
}

interface UpdateClaimStatusPayload {
  status: ClaimStatus;
  reimbursedAmount?: number;
}

export function useInsuranceClaimMutations() {
  const queryClient = useQueryClient();

  // pendingByCourier viaja en la MISMA respuesta que el listado (un solo
  // query, ver useInsuranceClaims.ts) — invalidar ["insuranceClaims","list"]
  // sin más claves alcanza para refrescar ambos a la vez (TanStack Query
  // matchea por prefijo: toca cualquier key que empiece con esto, sin
  // importar page/filters), sin necesitar una invalidación separada.
  function invalidateList() {
    queryClient.invalidateQueries({ queryKey: ["insuranceClaims", "list"] });
  }

  const resolveCustomerMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ResolveCustomerPayload }) =>
      apiFetch<ResolveCustomerResult>(`/insurance-claims/${id}/resolve-customer`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: invalidateList,
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateClaimStatusPayload }) =>
      apiFetch(`/insurance-claims/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    onSuccess: invalidateList,
  });

  return { resolveCustomerMutation, updateStatusMutation };
}
