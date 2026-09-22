import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import type { Resolver } from "react-hook-form";
import { useForm } from "react-hook-form";
import { applyApiErrorToForm } from "@/components/crud/applyApiErrorToForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { usePricingVisibility } from "@/hooks/usePricingVisibility";
import type { PricingField } from "@/lib/pricingFields";
import { AttributesFieldArray } from "./components/AttributesFieldArray";
import type { ProductStatus, Variant } from "./products.types";
import { useVariantMutations } from "./useVariantMutations";
import {
  attributesToPairs,
  pairsToAttributes,
  variantDefaultValues,
  variantFormSchema,
} from "./variants.schema";
import type { VariantFormValues } from "./variants.schema";

interface VariantFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productStatus: ProductStatus;
  variant: Variant | null; // null = modo crear
  // Precarga el campo PVP (viene de "Usar este PVP" en la calculadora de
  // precios) SIN guardar nada por sí sola: el usuario sigue teniendo que
  // tocar "Guardar" acá abajo, como cualquier otro cambio de este formulario.
  retailPriceOverride?: number;
}

// `name` tipado como PricingField (no un string suelto): si backend agrega o
// renombra un campo de precio en pricingFields.ts, TS marca acá cualquier
// desajuste en vez de dejarlo pasar silencioso.
const PRICE_FIELDS_CONFIG: { name: PricingField; label: string }[] = [
  { name: "costPriceCNY", label: "Costo de fábrica (CNY)" },
  { name: "wholesalePrice", label: "Precio mayorista" },
  { name: "wholesaleDiscountPct", label: "% descuento mayorista" },
  { name: "retailPrice", label: "Precio público (PVP)" },
  { name: "retailDiscountPct", label: "% descuento PVP" },
];

function toFormValues(variant: Variant | null, retailPriceOverride?: number): VariantFormValues {
  if (!variant) return { ...variantDefaultValues, ...(retailPriceOverride !== undefined && { retailPrice: retailPriceOverride }) };
  return {
    attributePairs: attributesToPairs(variant.attributes),
    sku: variant.sku,
    barcode: variant.barcode ?? "",
    warehouseLocation: variant.warehouseLocation ?? "",
    minStock: variant.minStock ?? undefined,
    weightKg: variant.weightKg ? Number(variant.weightKg) : undefined,
    dimensionsCm: variant.dimensionsCm ?? "",
    costPriceCNY: variant.costPriceCNY ? Number(variant.costPriceCNY) : undefined,
    wholesalePrice: variant.wholesalePrice ? Number(variant.wholesalePrice) : undefined,
    wholesaleDiscountPct: variant.wholesaleDiscountPct ? Number(variant.wholesaleDiscountPct) : undefined,
    // El override de la calculadora gana sobre el PVP guardado: es justo lo
    // que el usuario acaba de pedir usar. Sigue sin persistirse hasta "Guardar".
    retailPrice: retailPriceOverride ?? (variant.retailPrice ? Number(variant.retailPrice) : undefined),
    retailDiscountPct: variant.retailDiscountPct ? Number(variant.retailDiscountPct) : undefined,
    force: false,
  };
}

export function VariantFormDialog({
  open,
  onOpenChange,
  productId,
  productStatus,
  variant,
  retailPriceOverride,
}: VariantFormDialogProps) {
  const isEdit = variant !== null;
  const canSeePricing = usePricingVisibility();
  const { createMutation, updateMutation } = useVariantMutations(productId);

  const form = useForm<VariantFormValues>({
    resolver: zodResolver(variantFormSchema) as Resolver<VariantFormValues>,
    defaultValues: variantDefaultValues,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(toFormValues(variant, retailPriceOverride));
  }, [open, variant, retailPriceOverride]);

  function handleSubmit(values: VariantFormValues) {
    const attributes = pairsToAttributes(values.attributePairs);

    const payload = isEdit
      ? {
          attributes,
          sku: values.sku || undefined, // sku nunca se "limpia", solo se cambia u omite
          barcode: values.barcode || null,
          warehouseLocation: values.warehouseLocation || null,
          minStock: values.minStock ?? null,
          weightKg: values.weightKg ?? null,
          dimensionsCm: values.dimensionsCm || null,
          costPriceCNY: values.costPriceCNY ?? null,
          wholesalePrice: values.wholesalePrice ?? null,
          wholesaleDiscountPct: values.wholesaleDiscountPct ?? null,
          retailPrice: values.retailPrice ?? null,
          retailDiscountPct: values.retailDiscountPct ?? null,
        }
      : {
          attributes,
          sku: values.sku || undefined,
          barcode: values.barcode || undefined,
          warehouseLocation: values.warehouseLocation || undefined,
          minStock: values.minStock,
          weightKg: values.weightKg,
          dimensionsCm: values.dimensionsCm || undefined,
          costPriceCNY: values.costPriceCNY,
          wholesalePrice: values.wholesalePrice,
          wholesaleDiscountPct: values.wholesaleDiscountPct,
          retailPrice: values.retailPrice,
          retailDiscountPct: values.retailDiscountPct,
          force: values.force,
        };

    const action = isEdit
      ? updateMutation.mutateAsync({ id: variant.id, values: payload })
      : createMutation.mutateAsync(payload);

    action.then(() => onOpenChange(false)).catch((error: unknown) => applyApiErrorToForm(error, form));
  }

  const isPending = isEdit ? updateMutation.isPending : createMutation.isPending;
  // `force` solo tiene sentido al CREAR una variante para un producto ya
  // DISCONTINUED (updateVariantSchema del backend ni siquiera tiene este
  // campo — editar una variante existente nunca lo necesita).
  const showForceToggle = !isEdit && productStatus === "DISCONTINUED";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar variante" : "Nueva variante"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="grid gap-4">
            <AttributesFieldArray control={form.control} errors={form.formState.errors} />

            <FormField
              control={form.control}
              name="sku"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SKU</FormLabel>
                  <FormControl>
                    <Input placeholder="Se autogenera si lo dejás vacío" {...field} value={field.value ?? ""} />
                  </FormControl>
                  {!isEdit ? (
                    <FormDescription>
                      Si lo dejás vacío, se arma solo a partir del SKU del producto y los atributos.
                    </FormDescription>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="barcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Código de barras</FormLabel>
                    <FormControl>
                      <Input placeholder="Opcional" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="warehouseLocation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ubicación en bodega</FormLabel>
                    <FormControl>
                      <Input placeholder="Opcional" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="minStock"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Stock mínimo</FormLabel>
                    <FormControl>
                      <Input placeholder="Opcional" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="weightKg"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Peso (kg)</FormLabel>
                    <FormControl>
                      <Input placeholder="Opcional" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dimensionsCm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dimensiones (cm)</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: 20x15x10" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Los 5 campos de precio/costo NUNCA se renderizan para OPERATOR
                — no deshabilitados, no en gris: directamente no están en el
                array que se mapea, así que no existen en el DOM. Espeja
                exactamente PRICING_FIELDS del backend. */}
            {canSeePricing ? (
              <div className="grid grid-cols-2 gap-4 rounded-md border p-3">
                <p className="col-span-2 text-sm font-medium text-muted-foreground">Precios y costos</p>
                {PRICE_FIELDS_CONFIG.map((priceField) => (
                  <FormField
                    key={priceField.name}
                    control={form.control}
                    name={priceField.name}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{priceField.label}</FormLabel>
                        <FormControl>
                          <Input placeholder="Opcional" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
            ) : null}

            {showForceToggle ? (
              <FormField
                control={form.control}
                name="force"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2 rounded-md border p-3">
                    <FormControl>
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        className="size-4"
                      />
                    </FormControl>
                    <div className="grid gap-0.5 leading-none">
                      <FormLabel className="font-normal">
                        Crear igual (el producto está descontinuado)
                      </FormLabel>
                      <FormDescription>
                        Ej: estás reactivando esta línea con una variante nueva.
                      </FormDescription>
                    </div>
                  </FormItem>
                )}
              />
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Guardando..." : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
