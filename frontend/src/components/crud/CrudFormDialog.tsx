import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import type { FieldValues, Resolver } from "react-hook-form";
import { useForm } from "react-hook-form";
import type { UseMutationResult } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { applyApiErrorToForm } from "./applyApiErrorToForm";
import type { CrudResourceConfig } from "./types";

interface CrudFormDialogProps<TItem extends { id: string }, TFormValues extends FieldValues> {
  config: CrudResourceConfig<TItem, TFormValues>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: TItem | null; // null = modo crear
  createMutation: UseMutationResult<TItem, unknown, TFormValues>;
  updateMutation: UseMutationResult<TItem, unknown, { id: string; values: TFormValues }>;
}

export function CrudFormDialog<TItem extends { id: string }, TFormValues extends FieldValues>({
  config,
  open,
  onOpenChange,
  item,
  createMutation,
  updateMutation,
}: CrudFormDialogProps<TItem, TFormValues>) {
  const isEdit = item !== null;

  // El cast del resolver es necesario acá: zodResolver, combinado con un
  // TFormValues genérico (en vez de un tipo concreto conocido de antemano),
  // no logra que TS infiera que su resultado calza con Resolver<TFormValues>
  // exactamente — es una fricción conocida de RHF con wrappers genéricos, no
  // un problema real de tipos en runtime (el schema de cada recurso SIGUE
  // siendo el que valida sus propios campos).
  const form = useForm<TFormValues>({
    resolver: zodResolver(config.formSchema as never) as Resolver<TFormValues>,
    defaultValues: config.defaultFormValues as never,
  });

  // Al abrir el dialog (o cambiar de fila a editar), precarga el formulario:
  // vacío en modo crear, con los valores del item en modo editar.
  useEffect(() => {
    if (!open) return;
    const values = isEdit && config.toFormValues ? config.toFormValues(item) : config.defaultFormValues;
    form.reset(values);
  }, [open, item]);

  function handleSubmit(values: TFormValues) {
    const action = isEdit
      ? updateMutation.mutateAsync({ id: item.id, values })
      : createMutation.mutateAsync(values);

    action.then(() => onOpenChange(false)).catch((error: unknown) => applyApiErrorToForm(error, form));
  }

  const isPending = isEdit ? updateMutation.isPending : createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Editar ${config.singular}` : `Nuevo ${config.singular}`}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="grid gap-4">
            {/* Solo se llega acá cuando la config SÍ trae formFields (ver
                CrudTablePage's hasGenericForm) — el ?? [] es nada más para el
                type-checker, que no puede ver esa garantía a través del prop. */}
            {(config.formFields ?? []).map((fieldConfig) => (
              <FormField
                key={fieldConfig.name}
                control={form.control}
                name={fieldConfig.name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{fieldConfig.label}</FormLabel>
                    <FormControl>
                      {fieldConfig.type === "textarea" ? (
                        <Textarea placeholder={fieldConfig.placeholder} {...field} value={field.value ?? ""} />
                      ) : fieldConfig.type === "select" ? (
                        <Select onValueChange={field.onChange} value={field.value ?? ""}>
                          <SelectTrigger>
                            <SelectValue placeholder={fieldConfig.placeholder} />
                          </SelectTrigger>
                          <SelectContent>
                            {fieldConfig.options?.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input placeholder={fieldConfig.placeholder} {...field} value={field.value ?? ""} />
                      )}
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
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
