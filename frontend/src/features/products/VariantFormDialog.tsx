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
import { useNegotiatedCost } from "@/features/dispatchOrders/useNegotiatedCost";
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
  wholesalePriceOverride?: number;
}

function toFormValues(variant: Variant | null, retailPriceOverride?: number): VariantFormValues {
  if (!variant) return { ...variantDefaultValues, ...(retailPriceOverride !== undefined && { retailPrice: retailPriceOverride }) };
  return {
    attributePairs: attributesToPairs(variant.attributes),
    sku: variant.sku,
    barcode: variant.barcode ?? "",
    minStock: variant.minStock ?? undefined,
    weightKg: variant.weightKg ? Number(variant.weightKg) : undefined,
    maxStackUnits: variant.maxStackUnits ?? 1,
    dimensionsCm: variant.dimensionsCm ?? "",
    costPriceUSD: variant.costPriceUSD ? Number(variant.costPriceUSD) : undefined,
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
  wholesalePriceOverride,
}: VariantFormDialogProps) {
  const isEdit = variant !== null;
  const canSeePricing = usePricingVisibility();
  const { data: realCost } = useNegotiatedCost(variant?.id ?? "", open && canSeePricing && !!variant);
  const { createMutation, updateMutation } = useVariantMutations(productId);

  const form = useForm<VariantFormValues>({
    resolver: zodResolver(variantFormSchema) as Resolver<VariantFormValues>,
    defaultValues: variantDefaultValues,
  });

  useEffect(() => {
    if (!open) return;
    form.reset({ ...toFormValues(variant, retailPriceOverride), ...(wholesalePriceOverride !== undefined && { wholesalePrice: wholesalePriceOverride }) });
  }, [open, variant, retailPriceOverride, wholesalePriceOverride]);

  function handleSubmit(values: VariantFormValues) {
    const attributes = pairsToAttributes(values.attributePairs);

    const payload = isEdit
      ? {
          attributes,
          sku: values.sku || undefined, // sku nunca se "limpia", solo se cambia u omite
          barcode: values.barcode || null,
          minStock: values.minStock ?? null,
          weightKg: values.weightKg ?? null,
          maxStackUnits: values.maxStackUnits ?? 1,
          dimensionsCm: values.dimensionsCm || null,
          ...(retailPriceOverride !== undefined && { retailPrice: values.retailPrice }),
          ...(wholesalePriceOverride !== undefined && { wholesalePrice: values.wholesalePrice }),
        }
      : {
          attributes,
          sku: values.sku || undefined,
          barcode: values.barcode || undefined,
          minStock: values.minStock,
          weightKg: values.weightKg,
          maxStackUnits: values.maxStackUnits ?? 1,
          dimensionsCm: values.dimensionsCm || undefined,
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

            <div className="grid gap-4">
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

            <FormField control={form.control} name="maxStackUnits" render={({ field }) => <FormItem><FormLabel>Máximo de unidades por pila (incluye la base)</FormLabel><FormControl><Input type="number" min={1} max={1000} step={1} {...field} value={field.value ?? 1} /></FormControl><p className="text-xs text-muted-foreground">1 = no apilable. Dimensiones del empaque por unidad: largo × ancho × alto.</p><FormMessage /></FormItem>} />

            {canSeePricing ? (
              <section className="space-y-3 rounded-md border p-3">
                <p className="font-medium">Costo de importación (USD)</p>
                <p className="text-sm text-muted-foreground">
                  La importación registra el costo. En cada despacho ingresa el porcentaje de ganancia
                  negociado sobre el costo real, tanto para mayoristas como para clientes finales.
                </p>
                {!variant?.costPriceUSD ? (
                  <p className="text-sm">Pendiente de recibir una importación con costo y CBM.</p>
                ) : null}
                <div className="grid grid-cols-2 gap-4">
                  {([
                    ["costPriceUSD", "Costo de fábrica (USD)"],
                  ] as const).map(([name, label]) => (
                    <FormField key={name} control={form.control} name={name} render={({ field }) => (
                      <FormItem><FormLabel>{label}</FormLabel><FormControl>
                        <Input readOnly placeholder="Pendiente de importación" {...field} value={field.value ?? ""} />
                      </FormControl></FormItem>
                    )} />
                  ))}
                  <div className="text-sm"><p>Costo real promedio ponderado (USD)</p><p className="font-medium">{realCost != null ? '$' + realCost.toFixed(2) : "Pendiente de importación"}</p></div>
                </div>
              </section>
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
