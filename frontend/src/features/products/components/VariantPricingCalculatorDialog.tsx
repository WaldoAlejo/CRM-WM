import { PricingCalculatorDialog } from "@/features/pricing/PricingCalculatorDialog";
import { useLatestLandedCost } from "@/features/pricing/useLatestLandedCost";
import type { Variant } from "../products.types";

interface VariantPricingCalculatorDialogProps {
  variant: Variant;
  onOpenChange: (open: boolean) => void;
  onUsePvp: (pvp: number, wholesalePrice: number) => void;
}

// Calculadora "standalone": no depende de estar viendo un Lote de
// Importación — usa el costo aterrizado de la ÚLTIMA recepción de esta
// variante (si existe). Se monta solo mientras se necesita (ver VariantsTable:
// `{calculatorFor ? <VariantPricingCalculatorDialog .../> : null}`), así que
// "open" siempre es true acá adentro.
export function VariantPricingCalculatorDialog({ variant, onOpenChange, onUsePvp }: VariantPricingCalculatorDialogProps) {
  const { data: landedCost, isLoading } = useLatestLandedCost(variant.id, true);

  return (
    <PricingCalculatorDialog
      open
      onOpenChange={onOpenChange}
      title={`Calculadora de precios — ${variant.sku}`}
      isLoading={isLoading}
      landedCost={landedCost ?? null}
      onUsePvp={onUsePvp}
    />
  );
}
