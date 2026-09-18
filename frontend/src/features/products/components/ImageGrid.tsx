import { PlusIcon, Trash2Icon } from "lucide-react";
import { useRef } from "react";
import { getAssetUrl } from "@/lib/api";

interface ImageGridItem {
  id: string;
  url: string;
}

interface ImageGridProps {
  images: ImageGridItem[];
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
  isUploading: boolean;
}

// Sin reordenar (mover arriba/abajo): el backend no tiene ningún endpoint
// para persistir un orden manual (images.routes.ts solo tiene POST/DELETE) —
// agregar botones que no sobreviven a un refresh sería peor que no tenerlos.
export function ImageGrid({ images, onUpload, onDelete, isUploading }: ImageGridProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap gap-3">
      {images.map((image) => (
        <div key={image.id} className="group relative size-24 overflow-hidden rounded-md border">
          <img src={getAssetUrl(image.url)} alt="" className="size-full object-cover" />
          <button
            type="button"
            onClick={() => onDelete(image.id)}
            title="Eliminar imagen"
            className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
          >
            <Trash2Icon className="size-3.5" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
        className="flex size-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground hover:bg-accent disabled:opacity-50"
      >
        <PlusIcon className="size-5" />
        <span className="text-xs">{isUploading ? "Subiendo..." : "Subir"}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onUpload(file);
          event.target.value = ""; // permite volver a elegir el mismo archivo después
        }}
      />
    </div>
  );
}
