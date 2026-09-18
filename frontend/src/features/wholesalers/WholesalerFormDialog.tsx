import { zodResolver } from "@hookform/resolvers/zod";
import type { UseMutationResult } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Resolver } from "react-hook-form";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { applyApiErrorToForm } from "@/components/crud/applyApiErrorToForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import { wholesalerDefaultValues, wholesalerFormSchema } from "./wholesalers.schema";
import type { RucValidationResult, Wholesaler } from "./wholesalers.types";
import type { WholesalerFormValues } from "./wholesalers.schema";

interface WholesalerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  createMutation: UseMutationResult<Wholesaler, unknown, WholesalerFormValues>;
}

// Formulario a medida (no pasa por CrudFormDialog/el patrón genérico): el
// botón "Validar RUC" es una acción propia de este módulo, no algo que
// CrudResourceConfig deba saber modelar de forma genérica para los otros 5.
export function WholesalerFormDialog({ open, onOpenChange, createMutation }: WholesalerFormDialogProps) {
  const [validation, setValidation] = useState<RucValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const form = useForm<WholesalerFormValues>({
    resolver: zodResolver(wholesalerFormSchema as never) as Resolver<WholesalerFormValues>,
    defaultValues: wholesalerDefaultValues,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(wholesalerDefaultValues);
    setValidation(null);
  }, [open]);

  async function handleValidateRuc() {
    const ruc = form.getValues("ruc");
    const parsed = wholesalerFormSchema.shape.ruc.safeParse(ruc);
    if (!parsed.success) {
      form.setError("ruc", { message: parsed.error.issues[0]?.message ?? "RUC inválido" });
      return;
    }

    setIsValidating(true);
    try {
      const result = await apiFetch<RucValidationResult>("/wholesalers/validate-ruc", {
        method: "POST",
        body: JSON.stringify({ ruc }),
      });
      setValidation(result);
      if (result.found && result.businessName) {
        form.setValue("businessName", result.businessName);
        toast.success("RUC encontrado — razón social autocompletada");
      } else {
        toast.info("No se encontró información para este RUC. Completa los datos manualmente.");
      }
    } catch (error) {
      applyApiErrorToForm(error, form);
    } finally {
      setIsValidating(false);
    }
  }

  function handleSubmit(values: WholesalerFormValues) {
    createMutation
      .mutateAsync(values)
      .then(() => onOpenChange(false))
      .catch((error: unknown) => applyApiErrorToForm(error, form));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo mayorista</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="ruc"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>RUC</FormLabel>
                  <div className="flex gap-2">
                    <FormControl>
                      <Input placeholder="1234567890001" {...field} />
                    </FormControl>
                    <Button type="button" variant="outline" onClick={handleValidateRuc} disabled={isValidating}>
                      {isValidating ? "Validando..." : "Validar RUC"}
                    </Button>
                  </div>
                  {validation ? (
                    <p className="text-sm text-muted-foreground">
                      {validation.found
                        ? `Encontrado — estado tributario: ${validation.taxStatus ?? "no informado"}`
                        : "No se encontró información para este RUC — completa los datos manualmente."}
                    </p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="businessName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Razón social</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Comercial Andina S.A." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="contactName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre de contacto</FormLabel>
                    <FormControl>
                      <Input placeholder="Opcional" {...field} value={field.value ?? ""} />
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
                    <FormLabel>Teléfono</FormLabel>
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
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input placeholder="Opcional" {...field} value={field.value ?? ""} />
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
                    <Textarea placeholder="Opcional" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="creditLimit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cupo de crédito</FormLabel>
                    <FormControl>
                      <Input placeholder="Opcional" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="defaultCreditDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Días de crédito por defecto</FormLabel>
                    <FormControl>
                      <Input placeholder="Opcional" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Guardando..." : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
