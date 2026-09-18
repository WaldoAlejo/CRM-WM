import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Variant } from "../products.types";
import { useImageMutations } from "../useImageMutations";
import { ImageGrid } from "./ImageGrid";

interface VariantImagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  variant: Variant;
}

// Dialog aparte (no una miniatura por fila en VariantsTable): con varias
// variantes, mostrar imágenes dentro de la tabla la volvería exactamente lo
// abrumadora que se pidió evitar.
export function VariantImagesDialog({ open, onOpenChange, productId, variant }: VariantImagesDialogProps) {
  const { uploadMutation, deleteMutation } = useImageMutations(productId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Imágenes — {variant.label ?? variant.sku}</DialogTitle>
        </DialogHeader>
        <ImageGrid
          images={variant.images}
          isUploading={uploadMutation.isPending}
          onUpload={(file) => uploadMutation.mutate({ owner: { type: "variant", id: variant.id }, file })}
          onDelete={(imageId) => deleteMutation.mutate(imageId)}
        />
      </DialogContent>
    </Dialog>
  );
}
