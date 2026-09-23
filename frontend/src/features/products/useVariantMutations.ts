import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiFetch } from "@/lib/api";
import type { Variant } from "./products.types";

interface VariantWritePayload {
  attributes: Record<string, string>;
  sku?: string;
  barcode?: string | null;
  warehouseLocation?: string | null;
  minStock?: number | null;
  weightKg?: number | null;
  maxStackUnits?: number;
  dimensionsCm?: string | null;
  costPriceUSD?: number | null;
  wholesalePrice?: number | null;
  wholesaleDiscountPct?: number | null;
  retailPrice?: number | null;
  retailDiscountPct?: number | null;
  force?: boolean;
}

export function useVariantMutations(productId: string) {
  const queryClient = useQueryClient();

  function invalidateProduct() {
    queryClient.invalidateQueries({ queryKey: ["products", "detail", productId] });
    queryClient.invalidateQueries({ queryKey: ["products", "list"] }); // variantCount cambia
  }

  const createMutation = useMutation({
    mutationFn: (values: VariantWritePayload) =>
      apiFetch<Variant>(`/products/${productId}/variants`, { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => {
      invalidateProduct();
      toast.success("Variante creada correctamente");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: VariantWritePayload }) =>
      apiFetch<Variant>(`/variants/${id}`, { method: "PATCH", body: JSON.stringify(values) }),
    onSuccess: () => {
      invalidateProduct();
      toast.success("Variante actualizada correctamente");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/variants/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateProduct();
      toast.success("Variante eliminada correctamente");
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : "No se pudo eliminar. Intenta de nuevo.";
      toast.error(message);
    },
  });

  return { createMutation, updateMutation, deleteMutation };
}
