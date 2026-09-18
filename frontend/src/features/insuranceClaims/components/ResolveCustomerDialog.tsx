import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import type { Resolver } from "react-hook-form";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { applyApiErrorToForm } from "@/components/crud/applyApiErrorToForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import {
  resolveCustomerDefaultValues,
  resolveCustomerFormSchema,
} from "../insuranceClaims.schema";
import type { ResolveCustomerFormValues } from "../insuranceClaims.schema";
import type { ResolveCustomerResult } from "../insuranceClaims.types";
import { isReplacementResult } from "../insuranceClaims.types";
import { useInsuranceClaimMutations } from "../useInsuranceClaimMutations";

interface ResolveCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claimId: string;
}

function codAmountExpected(result: ResolveCustomerResult): number {
  if (!isReplacementResult(result)) return 0;
  return result.replacementOrder.items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);
}

export function ResolveCustomerDialog({ open, onOpenChange, claimId }: ResolveCustomerDialogProps) {
  const { resolveCustomerMutation } = useInsuranceClaimMutations();
  const [result, setResult] = useState<ResolveCustomerResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const form = useForm<ResolveCustomerFormValues>({
    resolver: zodResolver(resolveCustomerFormSchema) as Resolver<ResolveCustomerFormValues>,
    defaultValues: resolveCustomerDefaultValues,
  });

  useEffect(() => {
    if (open) {
      form.reset(resolveCustomerDefaultValues);
      setResult(null);
      setErrorMessage(null);
    }
  }, [open]);

  const resolution = form.watch("resolution");

  function handleSubmit(values: ResolveCustomerFormValues) {
    setErrorMessage(null);
    const payload =
      values.resolution === "REFUND"
        ? { resolution: "REFUND" as const, refundAmount: values.refundAmount! }
        : { resolution: "REPLACEMENT" as const };

    resolveCustomerMutation
      .mutateAsync({ id: claimId, payload })
      .then((res) => setResult(res))
      .catch((error: unknown) => {
        applyApiErrorToForm(error, form);
        // El toast de applyApiErrorToForm puede desaparecer solo — este
        // mensaje queda visible DENTRO del dialog mientras siga abierto,
        // que es justo lo que se pidió para el caso de stock insuficiente.
        setErrorMessage(error instanceof ApiError ? error.message : "Ocurrió un error inesperado. Intenta de nuevo.");
      });
  }

  // Tras confirmar con éxito, el dialog NO se cierra solo: muestra el
  // resultado (a qué orden linkea, cuánto sale a cobrar) hasta que el
  // usuario lo cierre a mano.
  if (result) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isReplacementResult(result) ? "Orden de reemplazo creada" : "Reembolso registrado"}
            </DialogTitle>
          </DialogHeader>
          {isReplacementResult(result) ? (
            <div className="space-y-2 text-sm">
              <p>
                Orden{" "}
                <Link to={`/dispatch-orders/${result.replacementOrder.id}`} className="font-medium hover:underline">
                  {result.replacementOrder.orderNumber}
                </Link>{" "}
                creada — contra entrega.
              </p>
              <p>
                COD esperado al confirmarla: <span className="font-medium">${codAmountExpected(result).toFixed(2)}</span>
              </p>
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <p>
                Reembolso de <span className="font-medium">${result.payment.amount}</span> registrado en la orden
                original.
              </p>
              <p>
                Estado de pago de la orden original: <span className="font-medium">{result.dispatchOrder.paymentStatus}</span>
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolver con cliente</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="resolution"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Resolución</FormLabel>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="resolution"
                        value="REPLACEMENT"
                        checked={field.value === "REPLACEMENT"}
                        onChange={() => field.onChange("REPLACEMENT")}
                      />
                      Reemplazo
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="resolution"
                        value="REFUND"
                        checked={field.value === "REFUND"}
                        onChange={() => field.onChange("REFUND")}
                      />
                      Reembolso
                    </label>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {resolution === "REFUND" ? (
              <FormField
                control={form.control}
                name="refundAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monto del reembolso</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} step="any" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {errorMessage ? <p className="text-sm font-medium text-destructive">{errorMessage}</p> : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={resolveCustomerMutation.isPending}>
                {resolveCustomerMutation.isPending ? "Confirmando..." : "Confirmar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
