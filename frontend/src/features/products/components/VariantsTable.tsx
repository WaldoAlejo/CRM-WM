import { ImageIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { ConfirmDeleteDialog } from "@/components/crud/ConfirmDeleteDialog";
import { DataTable } from "@/components/crud/DataTable";
import type { CrudColumn } from "@/components/crud/types";
import { Button } from "@/components/ui/button";
import { usePricingVisibility } from "@/hooks/usePricingVisibility";
import type { ProductStatus, Variant } from "../products.types";
import { useVariantMutations } from "../useVariantMutations";
import { VariantFormDialog } from "../VariantFormDialog";
import { VariantImagesDialog } from "./VariantImagesDialog";

interface VariantsTableProps {
  productId: string;
  productStatus: ProductStatus;
  variants: Variant[];
}

function money(value: string | null | undefined, prefix: string): string {
  return value ? `${prefix}${value}` : "—";
}

export function VariantsTable({ productId, productStatus, variants }: VariantsTableProps) {
  const canSeePricing = usePricingVisibility();
  const { deleteMutation } = useVariantMutations(productId);
  const [editing, setEditing] = useState<Variant | null | "new">(null);
  const [imagesFor, setImagesFor] = useState<Variant | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Mismo mecanismo que el backend (variants.serializer.ts): las columnas de
  // precio/costo directamente no se agregan al array si el rol no puede
  // verlas — no se renderizan vacías ni deshabilitadas, no existen.
  const columns: CrudColumn<Variant>[] = [
    { header: "SKU", cell: (v) => v.sku },
    { header: "Etiqueta", cell: (v) => v.label ?? "—" },
    { header: "Stock", cell: (v) => v.stock },
    { header: "Disponible", cell: (v) => v.stock - v.reservedStock },
    ...(canSeePricing
      ? ([
          { header: "Costo (CNY)", cell: (v) => money(v.costPriceCNY, "¥") },
          { header: "PVP", cell: (v) => money(v.retailPrice, "$") },
        ] satisfies CrudColumn<Variant>[])
      : []),
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Variantes ({variants.length})</h2>
        <Button size="sm" onClick={() => setEditing("new")}>
          Nueva variante
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={variants}
        isLoading={false}
        getRowId={(v) => v.id}
        actions={(variant) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" title="Imágenes" onClick={() => setImagesFor(variant)}>
              <ImageIcon />
            </Button>
            <Button variant="ghost" size="icon" title="Editar variante" onClick={() => setEditing(variant)}>
              <PencilIcon />
            </Button>
            <Button variant="ghost" size="icon" title="Eliminar variante" onClick={() => setDeleteId(variant.id)}>
              <Trash2Icon />
            </Button>
          </div>
        )}
      />

      <VariantFormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        productId={productId}
        productStatus={productStatus}
        variant={editing === "new" ? null : editing}
      />

      {imagesFor ? (
        <VariantImagesDialog
          open={imagesFor !== null}
          onOpenChange={(open) => !open && setImagesFor(null)}
          productId={productId}
          variant={imagesFor}
        />
      ) : null}

      <ConfirmDeleteDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        singular="variante"
        isPending={deleteMutation.isPending}
        onConfirm={() => {
          if (!deleteId) return;
          const id = deleteId;
          setDeleteId(null);
          deleteMutation.mutate(id);
        }}
      />
    </div>
  );
}
