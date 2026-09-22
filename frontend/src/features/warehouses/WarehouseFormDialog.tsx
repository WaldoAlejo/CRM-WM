import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import type { Resolver } from "react-hook-form";
import { useForm } from "react-hook-form";
import { applyApiErrorToForm } from "@/components/crud/applyApiErrorToForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  if (!warehouse) return warehouseDefaultValues;
  return {
    name: warehouse.name,
    address: warehouse.address ?? "",
    capacity: warehouse.capacity ?? undefined,
    phone: warehouse.phone ?? "",
    notes: warehouse.notes ?? "",
    managerId: warehouse.manager?.id ?? NO_MANAGER,
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

  useEffect(() => {
    if (!open) return;
    form.reset(toFormValues(warehouse));
  }, [open, warehouse]);

  function handleSubmit(values: WarehouseFormValues) {
    const managerId = values.managerId === NO_MANAGER || values.managerId === "" ? null : values.managerId;

    // Igual que VariantFormDialog: al editar se manda `null` explícito para
    // LIMPIAR un campo ya cargado; al crear, se omite (undefined) lo que
    // quedó vacío en vez de mandar null sobre algo que nunca existió.
    const payload: WarehouseWritePayload = isEdit
      ? {
          name: values.name,
          address: values.address || null,
          capacity: values.capacity ?? null,
          phone: values.phone || null,
          notes: values.notes || null,
          managerId,
        }
      : {
          name: values.name,
          address: values.address || undefined,
          capacity: values.capacity,
          phone: values.phone || undefined,
          notes: values.notes || undefined,
          managerId: managerId ?? undefined,
        };

    const action = isEdit
      ? updateMutation.mutateAsync({ id: warehouse.id, values: payload })
      : createMutation.mutateAsync(payload);

    action.then(() => onOpenChange(false)).catch((error: unknown) => applyApiErrorToForm(error, form));
  }

  const isPending = isEdit ? updateMutation.isPending : createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar bodega" : "Nueva bodega"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="grid gap-4">
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
                name="capacity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Capacidad (posiciones/pallets)</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} step={1} placeholder="Opcional" {...field} value={field.value ?? ""} />
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
                      <SelectTrigger disabled={loadingManagers}>
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
