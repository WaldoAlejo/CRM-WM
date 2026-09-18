import type { ProductImage } from "../products.types";
import { useImageMutations } from "../useImageMutations";
import { ImageGrid } from "./ImageGrid";

export function ProductImagesSection({ productId, images }: { productId: string; images: ProductImage[] }) {
  const { uploadMutation, deleteMutation } = useImageMutations(productId);

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">Imágenes del producto</h2>
      <ImageGrid
        images={images}
        isUploading={uploadMutation.isPending}
        onUpload={(file) => uploadMutation.mutate({ owner: { type: "product", id: productId }, file })}
        onDelete={(imageId) => deleteMutation.mutate(imageId)}
      />
    </div>
  );
}
