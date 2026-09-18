import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import type { Resolver } from "react-hook-form";
import { useForm } from "react-hook-form";
import { applyApiErrorToForm } from "@/components/crud/applyApiErrorToForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { productDefaultValues, productFormSchema } from "./products.schema";
import type { ProductFormValues } from "./products.schema";
import type { ProductDetail, ProductListItem } from "./products.types";
import { useBrandOptions } from "./useBrandOptions";
import { useCategoryOptions } from "./useCategoryOptions";
import { useProductMutations } from "./useProductMutations";

const NONE = "__none__"; // Radix Select no permite value="" — "sin marca/subcategoría" se traduce a esto.

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductDetail | ProductListItem | null; // null = modo crear
}

function toFormValues(product: ProductFormDialogProps["product"]): ProductFormValues {
  if (!product) return productDefaultValues;
  return {
    sku: product.sku,
    name: product.name,
    description: "description" in product ? (product.description ?? "") : "",
    model: product.model ?? "",
    barcode: "barcode" in product ? (product.barcode ?? "") : "",
    categoryId: product.category.id,
    subcategoryId: product.subcategory?.id ?? "",
    brandId: product.brand?.id ?? "",
  };
}

export function ProductFormDialog({ open, onOpenChange, product }: ProductFormDialogProps) {
  const isEdit = product !== null;
  const { data: categories } = useCategoryOptions();
  const { data: brands } = useBrandOptions();
  const { createMutation, updateMutation } = useProductMutations();

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema) as Resolver<ProductFormValues>,
    defaultValues: productDefaultValues,
  });

  // Rastrea si el usuario ya reconfirmó la subcategoría DESPUÉS de cambiar de
  // categoría en modo edición — el backend rechaza con 400 si el producto ya
  // tenía subcategoría, se cambia de categoría, y el body no confirma
  // explícitamente qué pasa con ella. Se resuelve acá, ANTES del round-trip,
  // en vez de dejar que el usuario se entere por el error del backend.
  const originalCategoryId = product?.category.id;
  const originalHadSubcategory = product?.subcategory !== null && product?.subcategory !== undefined;
  const [subcategoryConfirmed, setSubcategoryConfirmed] = useState(true);

  useEffect(() => {
    if (!open) return;
    form.reset(toFormValues(product));
    setSubcategoryConfirmed(true);
  }, [open, product]);

  const watchedCategoryId = form.watch("categoryId");
  const selectedCategory = categories?.find((c) => c.id === watchedCategoryId);

  function handleCategoryChange(value: string) {
    form.setValue("categoryId", value);
    form.setValue("subcategoryId", "");
    const newCategory = categories?.find((c) => c.id === value);
    const hasSubcategoryOptions = (newCategory?.subcategories.length ?? 0) > 0;
    // Si la categoría nueva no tiene subcategorías, no hay nada que
    // reconfirmar: el Select de subcategoría queda disabled y jamás dispara
    // onValueChange, así que exigir una reconfirmación acá dejaría el gate
    // imposible de resolver (el usuario nunca podría guardar).
    const shouldBlock = isEdit && originalHadSubcategory && value !== originalCategoryId && hasSubcategoryOptions;
    setSubcategoryConfirmed(!shouldBlock);
  }

  function handleSubmit(values: ProductFormValues) {
    if (!subcategoryConfirmed) {
      form.setError("subcategoryId", {
        message:
          "Cambiaste de categoría y el producto ya tenía subcategoría — elegí una (o \"Sin subcategoría\") antes de guardar.",
      });
      return;
    }

    const payload = {
      sku: values.sku,
      name: values.name,
      description: values.description || undefined,
      model: values.model || undefined,
      barcode: values.barcode || undefined,
      categoryId: values.categoryId,
      // En edición se manda SIEMPRE explícito (null si se limpió), nunca se
      // omite la key: es justo lo que el backend exige para no rechazar el
      // cambio de categoría con subcategoría ya reconfirmada arriba.
      subcategoryId: isEdit ? values.subcategoryId || null : values.subcategoryId || undefined,
      brandId: isEdit ? values.brandId || null : values.brandId || undefined,
    };

    const action = isEdit
      ? updateMutation.mutateAsync({ id: product.id, values: payload })
      : createMutation.mutateAsync(payload);

    action.then(() => onOpenChange(false)).catch((error: unknown) => applyApiErrorToForm(error, form));
  }

  const isPending = isEdit ? updateMutation.isPending : createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar producto" : "Nuevo producto"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="sku"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SKU</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: WM-0012" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Freidora de aire WM" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Opcional" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Modelo</FormLabel>
                    <FormControl>
                      <Input placeholder="Opcional" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoría</FormLabel>
                    <Select value={field.value} onValueChange={handleCategoryChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Elegí una categoría" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories?.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="subcategoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subcategoría</FormLabel>
                    <Select
                      value={field.value || NONE}
                      onValueChange={(value) => {
                        field.onChange(value === NONE ? "" : value);
                        setSubcategoryConfirmed(true);
                      }}
                      disabled={!selectedCategory || selectedCategory.subcategories.length === 0}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sin subcategoría" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {/* onClick explícito (además de onValueChange): si el
                            gate ya dejó subcategoryId en "" tras cambiar de
                            categoría, el valor efectivo YA es "__none__" —
                            re-elegir esa misma opción para reconfirmar no
                            dispara onValueChange (Radix no emite el evento
                            cuando el valor no cambia), y el usuario quedaría
                            sin forma de satisfacer el gate. El click sí
                            ocurre siempre, cambie o no el valor. */}
                        <SelectItem value={NONE} onClick={() => setSubcategoryConfirmed(true)}>
                          Sin subcategoría
                        </SelectItem>
                        {selectedCategory?.subcategories.map((sub) => (
                          <SelectItem key={sub.id} value={sub.id}>
                            {sub.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="brandId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Marca</FormLabel>
                  <Select
                    value={field.value || NONE}
                    onValueChange={(value) => field.onChange(value === NONE ? "" : value)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Sin marca" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>Sin marca</SelectItem>
                      {brands?.map((brand) => (
                        <SelectItem key={brand.id} value={brand.id}>
                          {brand.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

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
