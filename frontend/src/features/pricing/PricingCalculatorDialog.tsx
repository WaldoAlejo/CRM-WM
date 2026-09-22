import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PricingCalculatorPanel } from "./PricingCalculatorPanel";

interface PricingCalculatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  isLoading?: boolean;
  // null = esta variante todavía no tiene un costo aterrizado del que partir.
  landedCost: number | null;
  initialRetailPrice?: number | null;
  initialWholesaleDiscountPct?: number | null;
  onUsePvp: (pvp: number) => void;
}

// Envoltorio de Dialog para PricingCalculatorPanel: lo único que agrega es el
// chrome del diálogo y los 2 estados que no dependen de la calculadora en sí
// (cargando el costo más reciente / sin costo del que partir). Se usa tanto
// en el detalle de un Lote de Importación (costo ya conocido) como desde
// Producto/Variante (costo de la última recepción, vía fetch).
export function PricingCalculatorDialog({
  open,
  onOpenChange,
  title,
  isLoading,
  landedCost,
  initialRetailPrice,
  initialWholesaleDiscountPct,
  onUsePvp,
}: PricingCalculatorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : landedCost === null ? (
          <p className="text-sm text-muted-foreground">
            Esta variante todavía no tiene una recepción con costo aterrizado registrado: no hay una base sobre la
            cual calcular un PVP.
          </p>
        ) : (
          <PricingCalculatorPanel
            landedCost={landedCost}
            initialRetailPrice={initialRetailPrice}
            initialWholesaleDiscountPct={initialWholesaleDiscountPct}
            onUsePvp={(pvp) => {
              onUsePvp(pvp);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
