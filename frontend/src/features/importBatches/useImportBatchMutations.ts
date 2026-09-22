import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ReceiveResponse } from "./importBatches.types";

export interface CreateBatchPayload {
  containerType: "20" | "40" | "40HC";
  containerCbm: number;
  reference: string;
  supplierId?: string;
  arrivalDate: string;
  notes?: string;
  freightCost?: number;
  customsCost?: number;
  otherCosts?: number;
}

export interface ReceiveLinePayload {
  variantId: string;
  quantity: number;
  unitCost: number;
  volumeCbm: number;
  locationId?: string;
  notes?: string;
}

export function useImportBatchMutations() {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (values: CreateBatchPayload) =>
      apiFetch<{ id: string }>("/import-batches", { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["importBatches", "list"] }),
  });

  // Idempotency-Key: el backend deduplica reintentos del MISMO envío (doble
  // clic, timeout de red) devolviendo la respuesta ya guardada en vez de
  // volver a crear movimientos y sumar stock dos veces. La key la genera la
  // pantalla una vez por intento de recepción y se reutiliza si se reintenta.
  const receiveMutation = useMutation({
    mutationFn: ({ id, lines, idempotencyKey }: { id: string; lines: ReceiveLinePayload[]; idempotencyKey: string }) =>
      apiFetch<ReceiveResponse>(`/import-batches/${id}/receive`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ lines }),
      }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["importBatches"] });
      queryClient.invalidateQueries({ queryKey: ["importBatches", "detail", id] });
      // El stock y el stock por ubicación cambiaron.
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  return { createMutation, receiveMutation };
}
