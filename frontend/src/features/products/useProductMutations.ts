import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiFetch } from "@/lib/api";
import type { ProductDetail } from "./products.types";

interface ProductWritePayload {
  sku: string;
  name: string;
  description?: string;
  model?: string;
  barcode?: string;
  categoryId: string;
  subcategoryId?: string | null;
  brandId?: string | null;
}

export function useProductMutations() {
  const queryClient = useQueryClient();

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  const createMutation = useMutation({
    mutationFn: (values: ProductWritePayload) => apiFetch<ProductDetail>("/products", { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => {
      invalidateAll();
      toast.success("Producto creado correctamente");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ProductWritePayload }) =>
      apiFetch<ProductDetail>(`/products/${id}`, { method: "PATCH", body: JSON.stringify(values) }),
    onSuccess: () => {
      invalidateAll();
      toast.success("Producto actualizado correctamente");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/products/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateAll();
      toast.success("Producto eliminado correctamente");
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : "No se pudo eliminar. Intenta de nuevo.";
      toast.error(message);
    },
  });

  return { createMutation, updateMutation, deleteMutation };
}
