import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiFetch } from "@/lib/api";

type ImageOwner = { type: "product"; id: string } | { type: "variant"; id: string };

function uploadEndpoint(owner: ImageOwner): string {
  return owner.type === "product" ? `/products/${owner.id}/images` : `/variants/${owner.id}/images`;
}

// Compartido entre imágenes de producto y de variante: mismo endpoint de
// borrado (DELETE /images/:id) para ambos, mismo patrón de invalidar el
// detalle del producto (las imágenes de variante también viven anidadas ahí).
export function useImageMutations(productId: string) {
  const queryClient = useQueryClient();

  function invalidateProduct() {
    queryClient.invalidateQueries({ queryKey: ["products", "detail", productId] });
  }

  const uploadMutation = useMutation({
    mutationFn: ({ owner, file }: { owner: ImageOwner; file: File }) => {
      const formData = new FormData();
      formData.append("image", file);
      return apiFetch(uploadEndpoint(owner), { method: "POST", body: formData });
    },
    onSuccess: () => {
      invalidateProduct();
      toast.success("Imagen subida correctamente");
    },
    // Nunca silencioso: acá es donde el rechazo de un archivo inválido (ej.
    // un .txt — el backend responde 400 "Formato de imagen no permitido
    // (solo JPEG, PNG o WEBP)") tiene que llegar a la persona, no quedarse
    // solo en la consola.
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : "No se pudo subir la imagen. Intenta de nuevo.";
      toast.error(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (imageId: string) => apiFetch<void>(`/images/${imageId}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateProduct();
      toast.success("Imagen eliminada correctamente");
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : "No se pudo eliminar la imagen. Intenta de nuevo.";
      toast.error(message);
    },
  });

  return { uploadMutation, deleteMutation };
}
