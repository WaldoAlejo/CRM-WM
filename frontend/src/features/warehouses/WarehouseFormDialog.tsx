import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import type { Resolver } from "react-hook-form";
import { useForm, useWatch } from "react-hook-form";
import { applyApiErrorToForm } from "@/components/crud/applyApiErrorToForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useWarehouseManagerOptions } from "./useWarehouseManagerOptions";
import { useWarehouseMutations } from "./useWarehouseMutations";
import type { WarehouseWritePayload } from "./useWarehouseMutations";
import { warehouseDefaultValues, warehouseFormSchema } from "./warehouses.schema";
import type { WarehouseFormValues } from "./warehouses.schema";
import type { Warehouse } from "./warehouses.types";
import { WarehouseLayoutEditor } from "./WarehouseLayoutEditor";
import { layoutVolumeCbm } from "./warehouseSpatialCore";
import { isSpatialLayout, newSpatialLayout, toSpatialLayout } from "./warehouseSpatialCore";
import { SpatialWarehouseEditor } from "./SpatialWarehouseEditor";
const capacityOf = layoutVolumeCbm;

interface WarehouseFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouse: Warehouse | null; // null = modo crear
}

// Sentinel del Select: Radix no permite value="" en un SelectItem (lo usa
// internamente para "sin selección") — mismo patrón que NO_LOCATION en
// CreateConsignmentLotPage. Nunca se manda tal cual a la API.
const NO_MANAGER = "__none__";

function toFormValues(warehouse: Warehouse | null): WarehouseFormValues {
  if (!warehouse) return { ...warehouseDefaultValues, layout: newSpatialLayout() };
  return {
    name: warehouse.name,
    address: warehouse.address ?? "",
    capacityCbm: warehouse.capacityCbm != null ? Number(warehouse.capacityCbm) : undefined,
    phone: warehouse.phone ?? "",
    notes: warehouse.notes ?? "",
    managerId: warehouse.manager?.id ?? NO_MANAGER,
    layout: warehouse.layout ?? undefined,
  };
}

export function WarehouseFormDialog({ open, onOpenChange, warehouse }: WarehouseFormDialogProps) {
  const isEdit = warehouse !== null;
  const { createMutation, updateMutation } = useWarehouseMutations();
  const { data: managerOptions, isLoading: loadingManagers } = useWarehouseManagerOptions();

  const form = useForm<WarehouseFormValues>({
    resolver: zodResolver(warehouseFormSchema) as Resolver<WarehouseFormValues>,
    defaultValues: warehouseDefaultValues,
  });
  const layout = useWatch({ control: form.control, name: "layout" });

  useEffect(() => {
    if (!open) return;
    form.reset(toFormValues(warehouse));
  }, [open, warehouse, form]);

  function handleSubmit(values: WarehouseFormValues) {
    const managerId = values.managerId === NO_MANAGER || values.managerId === "" ? null : values.managerId;

    // Igual que VariantFormDialog: al editar se manda `null` explícito para
    // LIMPIAR un campo ya cargado; al crear, se omite (undefined) lo que
    // quedó vacío en vez de mandar null sobre algo que nunca existió.
    const payload: WarehouseWritePayload = isEdit
      ? {
          name: values.name,
          address: values.address || null,
          capacityCbm: values.layout ? capacityOf(values.layout) : values.capacityCbm ?? null,
          phone: values.phone || null,
          notes: values.notes || null,
          managerId,
        }
      : {
          name: values.name,
          address: values.address || undefined,
          capacityCbm: values.layout ? capacityOf(values.layout) : values.capacityCbm,
          phone: values.phone || undefined,
          notes: values.notes || undefined,
          managerId: managerId ?? undefined,
        };
    if (values.layout) payload.layout = values.layout;

    const action = isEdit
      ? updateMutation.mutateAsync({ id: warehouse.id, values: payload })
      : createMutation.mutateAsync(payload);

    action.then(() => onOpenChange(false)).catch((error: unknown) => applyApiErrorToForm(error, form));
  }

  const isPending = isEdit ? updateMutation.isPending : createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-h-[90vh] overflow-y-auto ${layout ? "max-w-[1500px] w-[96vw]" : ""}`}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar bodega" : "Nueva bodega"}</DialogTitle>
          <DialogDescription>Configura los datos de la bodega y diseña sus ubicaciones de almacenamiento.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form noValidate onSubmit={form.handleSubmit(handleSubmit)} className="grid gap-4">
            <div className={layout ? "grid min-w-0 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]" : ""}>
            <fieldset disabled={isPending} className="grid min-w-0 content-start gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Bodega Central" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dirección</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Dirección completa (opcional)" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="capacityCbm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Capacidad útil (m³)</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} step="any" placeholder="Opcional" {...field} readOnly={Boolean(layout)} value={layout ? capacityOf(layout) : field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Teléfono de contacto</FormLabel>
                    <FormControl>
                      <Input placeholder="Opcional" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="managerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Responsable de bodega</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || NO_MANAGER}>
                    <FormControl>
                      <SelectTrigger disabled={loadingManagers || isPending}>
                        <SelectValue placeholder="Sin responsable" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_MANAGER}>Sin responsable</SelectItem>
                      {managerOptions.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.name} ({user.role})
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
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Opcional" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {layout ? <p className="text-xs text-muted-foreground">Volumen útil = superficie de almacenamiento × altura disponible. El límite de apilamiento se configura por producto.</p> : <Button type="button" variant="outline" onClick={() => form.setValue("layout", newSpatialLayout(), { shouldDirty: true })}>Diseñar ubicaciones en un plano</Button>}
            </fieldset>
            {layout ? <div className="min-w-0">
              <>{isSpatialLayout(layout) ? <SpatialWarehouseEditor value={layout} disabled={isPending} onChange={value => form.setValue("layout", value, { shouldDirty: true, shouldValidate: true })} /> : <><Button type="button" variant="outline" className="mb-3" disabled={isPending} onClick={() => form.setValue("layout", toSpatialLayout(layout), { shouldDirty: true, shouldValidate: true })}>Editar como plano de espacios</Button><WarehouseLayoutEditor value={layout} disabled={isPending} onChange={value => {
                form.setValue("layout", value, { shouldDirty: true, shouldValidate: true });
              }} /></>}</>
              <LayoutErrors error={form.formState.errors.layout} />
              {!warehouse?.layout && (isSpatialLayout(layout) ? layout.elements.length === 0 : layout.positions.length === 0) ? <Button type="button" variant="ghost" disabled={isPending} onClick={() => form.setValue("layout", undefined, { shouldDirty: true, shouldValidate: true })}>Continuar sin plano</Button> : null}
            </div> : null}
            </div>
            <DialogFooter className="sticky bottom-0 z-10 border-t bg-background py-3">
              <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
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

function LayoutErrors({ error }: { error: unknown }) {
  function messages(value: unknown): string[] {
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    if (typeof record.message === "string") return [record.message];
    return Object.entries(record).filter(([key]) => key !== "ref").flatMap(([, child]) => messages(child));
  }
  const all = [...new Set(messages(error))];
  return all.length ? <div role="alert" className="mt-2 text-sm text-destructive">{all.map(message => <p key={message}>{message}</p>)}</div> : null;
}
