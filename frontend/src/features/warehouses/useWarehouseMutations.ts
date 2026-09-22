import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiFetch } from "@/lib/api";
import type { Warehouse } from "./warehouses.types";

// Payload real de la API (backend/src/modules/warehouses/warehouses.schemas.ts):
// distinto del tipo de RHF (WarehouseFormValues, todo strings/sentinels de
// input) — WarehouseFormDialog arma esto en el submit, igual que
// useVariantMutations/VariantFormDialog.
export interface WarehouseWritePayload {
  name?: string;
  address?: string | null;
  capacity?: number | null;
  phone?: string | null;
  notes?: string | null;
  managerId?: string | null;
}

export function useWarehouseMutations() {
  const queryClient = useQueryClient();

  // Prefijo amplio: invalida tanto la lista/opciones (["warehouses","options"])
  // como cualquier detalle cacheado (["warehouses", id]).
  function invalidateWarehouses() {
    queryClient.invalidateQueries({ queryKey: ["warehouses"] });
  }

  const createMutation = useMutation({
    mutationFn: (values: WarehouseWritePayload) =>
      apiFetch<Warehouse>("/warehouses", { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => {
      invalidateWarehouses();
      toast.success("Bodega creada correctamente");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: WarehouseWritePayload }) =>
      apiFetch<Warehouse>(`/warehouses/${id}`, { method: "PATCH", body: JSON.stringify(values) }),
    onSuccess: () => {
      invalidateWarehouses();
      toast.success("Bodega actualizada correctamente");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/warehouses/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateWarehouses();
      toast.success("Bodega eliminada correctamente");
    },
    // Nunca silencioso: el 409 de "tiene ubicaciones activas" (o devoluciones
    // pendientes en su Cuarentena) es el único aviso que recibe el usuario.
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : "No se pudo eliminar. Intenta de nuevo.";
      toast.error(message);
    },
  });

  return { createMutation, updateMutation, deleteMutation };
}
