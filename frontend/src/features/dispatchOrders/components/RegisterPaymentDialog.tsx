import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import type { Resolver } from "react-hook-form";
import { useForm } from "react-hook-form";
import { applyApiErrorToForm } from "@/components/crud/applyApiErrorToForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { paymentDefaultValues, paymentFormSchema } from "../dispatchOrders.schema";
import type { PaymentFormValues } from "../dispatchOrders.schema";
import { usePaymentMutations } from "../usePaymentMutations";

interface RegisterPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
}

export function RegisterPaymentDialog({ open, onOpenChange, orderId }: RegisterPaymentDialogProps) {
  const { addPaymentMutation } = usePaymentMutations(orderId);

  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentFormSchema) as Resolver<PaymentFormValues>,
    defaultValues: paymentDefaultValues,
  });

  useEffect(() => {
    if (open) form.reset(paymentDefaultValues);
  }, [open]);

  function handleSubmit(values: PaymentFormValues) {
    const payload = {
      amount: values.amount,
      method: values.method,
      paidAt: values.paidAt || undefined,
      notes: values.notes || undefined,
    };
    addPaymentMutation
      .mutateAsync(payload)
      .then(() => onOpenChange(false))
      .catch((error: unknown) => applyApiErrorToForm(error, form));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pago</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monto</FormLabel>
                  <FormControl>
                    <Input type="number" min={0} step="any" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Método</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: efectivo, transferencia" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="paidAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de pago</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} value={field.value ?? ""} />
                  </FormControl>
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
                    <Input placeholder="Opcional" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={addPaymentMutation.isPending}>
                {addPaymentMutation.isPending ? "Guardando..." : "Registrar pago"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
