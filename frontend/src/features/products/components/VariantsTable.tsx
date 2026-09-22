import { CalculatorIcon, ImageIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmDeleteDialog } from "@/components/crud/ConfirmDeleteDialog";
import { DataTable } from "@/components/crud/DataTable";
import type { CrudColumn } from "@/components/crud/types";
import { Button } from "@/components/ui/button";
import { usePricingVisibility } from "@/hooks/usePricingVisibility";
import type { ProductStatus, Variant } from "../products.types";
import { useVariantMutations } from "../useVariantMutations";
import { VariantFormDialog } from "../VariantFormDialog";
import { VariantImagesDialog } from "./VariantImagesDialog";
import { VariantPricingCalculatorDialog } from "./VariantPricingCalculatorDialog";

// Solicitud de apertura que viene de FUERA de esta tabla (hoy: "Usar este
// PVP" en la calculadora inline de un Lote de Importación, que navega hasta
// acá por URL — ver ProductDetailPage). `retailPriceOverride` nunca se
// guarda solo: solo precarga el campo del formulario de edición.
export interface PendingVariantEdit {
  variantId: string;
  retailPriceOverride?: number;
  wholesalePriceOverride?: number;
}

interface VariantsTableProps {
  productId: string;
  productStatus: ProductStatus;
  variants: Variant[];
  pendingEdit?: PendingVariantEdit | null;
  onPendingEditHandled?: () => void;
}

function money(value: string | null | undefined, prefix: string): string {
  return value ? `${prefix}${value}` : "—";
}

export function VariantsTable({ productId, productStatus, variants, pendingEdit, onPendingEditHandled }: VariantsTableProps) {
  const canSeePricing = usePricingVisibility();
  const { deleteMutation } = useVariantMutations(productId);
  const [editing, setEditing] = useState<Variant | null | "new">(null);
  const [retailPriceOverride, setRetailPriceOverride] = useState<number | undefined>(undefined);
  const [wholesalePriceOverride, setWholesalePriceOverride] = useState<number | undefined>();
  const [imagesFor, setImagesFor] = useState<Variant | null>(null);
  const [calculatorFor, setCalculatorFor] = useState<Variant | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  function openEdit(variant: Variant | "new", override?: number, wholesaleOverride?: number) {
    setWholesalePriceOverride(wholesaleOverride);
    setRetailPriceOverride(override);
    setEditing(variant);
  }

  // Abre la edición pedida desde afuera (llega por URL, ver ProductDetailPage)
  // en cuanto la variante correspondiente esté cargada, y avisa para que el
  // padre limpie ese pedido (los query params) — así no se reabre en un refresh.
  useEffect(() => {
    if (!pendingEdit) return;
    const variant = variants.find((v) => v.id === pendingEdit.variantId);
    if (!variant) return;
    openEdit(variant, pendingEdit.retailPriceOverride, pendingEdit.wholesalePriceOverride);
    onPendingEditHandled?.();
  }, [pendingEdit, variants, onPendingEditHandled]);

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
          { header: "Costo (USD)", cell: (v) => money(v.costPriceUSD, "$") },
          { header: "Mayorista (USD)", cell: (v) => money(v.wholesalePrice, "$") },
          { header: "PVP", cell: (v) => money(v.retailPrice, "$") },
        ] satisfies CrudColumn<Variant>[])
      : []),
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Variantes ({variants.length})</h2>
        <Button size="sm" onClick={() => openEdit("new")}>
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
            {/* Calculadora de precios: expone costo aterrizado y margen —
                misma condición que las columnas de precio, ADMIN/CEO solo. */}
            {canSeePricing ? (
              <Button variant="ghost" size="icon" title="Calculadora de precios" onClick={() => setCalculatorFor(variant)}>
                <CalculatorIcon />
              </Button>
            ) : null}
            <Button variant="ghost" size="icon" title="Imágenes" onClick={() => setImagesFor(variant)}>
              <ImageIcon />
            </Button>
            <Button variant="ghost" size="icon" title="Editar variante" onClick={() => openEdit(variant)}>
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
        retailPriceOverride={retailPriceOverride}
        wholesalePriceOverride={wholesalePriceOverride}
      />

      {imagesFor ? (
        <VariantImagesDialog
          open={imagesFor !== null}
          onOpenChange={(open) => !open && setImagesFor(null)}
          productId={productId}
          variant={imagesFor}
        />
      ) : null}

      {calculatorFor ? (
        <VariantPricingCalculatorDialog
          variant={calculatorFor}
          onOpenChange={(open) => !open && setCalculatorFor(null)}
          onUsePvp={(pvp, wholesalePrice) => {
            const variant = calculatorFor;
            setCalculatorFor(null);
            openEdit(variant, pvp, wholesalePrice);
          }}
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
