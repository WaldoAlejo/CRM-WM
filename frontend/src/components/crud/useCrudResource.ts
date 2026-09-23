import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FieldValues } from "react-hook-form";
import { toast } from "sonner";
import { ApiError, apiFetch, normalizeListResponse } from "@/lib/api";
import type { CrudResourceConfig } from "./types";

const PAGE_SIZE = 20;

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function useCrudResource<TItem extends { id: string }, TFormValues extends FieldValues>(
  config: CrudResourceConfig<TItem, TFormValues>
) {
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const listQueryKey = [config.resourceKey, "list", page] as const;

  const listQuery = useQuery({
    queryKey: listQueryKey,
    queryFn: () =>
      apiFetch<unknown>(`${config.listEndpoint}?page=${page}&pageSize=${PAGE_SIZE}`).then((raw) =>
        normalizeListResponse<TItem>(raw)
      ),
  });

  function invalidateList() {
    queryClient.invalidateQueries({ queryKey: [config.resourceKey, "list"] });
    if (config.resourceKey === "warehouses" || config.resourceKey.startsWith("locations-")) {
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
    }
  }

  const createMutation = useMutation({
    mutationFn: (values: TFormValues) =>
      apiFetch<TItem>(config.createEndpoint!, { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => {
      invalidateList();
      toast.success(`${capitalize(config.singular)} creado correctamente`);
    },
    // El toast de error específico de este submit lo maneja el propio
    // formulario (applyApiErrorToForm), porque ahí también hay que resaltar
    // el campo — acá no repetimos el toast para no duplicarlo.
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: TFormValues }) =>
      apiFetch<TItem>(config.updateEndpoint!(id), { method: "PATCH", body: JSON.stringify(values) }),
    onSuccess: () => {
      invalidateList();
      toast.success(`${capitalize(config.singular)} actualizado correctamente`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch<void>(config.deleteEndpoint!(id), { method: "DELETE" }),
    onSuccess: () => {
      invalidateList();
      toast.success(`${capitalize(config.singular)} eliminado correctamente`);
    },
    // Nunca silencioso: borrar no pasa por un formulario que pueda resaltar
    // un campo, así que el ÚNICO lugar donde el usuario se entera de un 409
    // (ej. "tiene productos activos asociados") es este toast. Sin esto, el
    // error quedaría solo en la consola y el usuario vería la fila seguir
    // ahí sin ninguna explicación.
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : "No se pudo eliminar. Intenta de nuevo.";
      toast.error(message);
    },
  });

  return {
    page,
    setPage,
    pageSize: PAGE_SIZE,
    listQuery,
    createMutation,
    updateMutation,
    deleteMutation,
  };
}
