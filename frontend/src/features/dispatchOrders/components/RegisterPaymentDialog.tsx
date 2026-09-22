import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import type { Resolver } from "react-hook-form";
import { useForm } from "react-hook-form";
import { applyApiErrorToForm } from "@/components/crud/applyApiErrorToForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { paymentDefaultValues, paymentFormSchema } from "../dispatchOrders.schema";
import type { PaymentFormValues } from "../dispatchOrders.schema";
import { usePaymentMutations } from "../usePaymentMutations";

interface RegisterPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
}

const MAX_PROOF_BYTES = 5 * 1024 * 1024; // igual que el límite del backend
const ACCEPTED_PROOF_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function RegisterPaymentDialog({ open, onOpenChange, orderId }: RegisterPaymentDialogProps) {
  const { addPaymentMutation } = usePaymentMutations(orderId);

  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentFormSchema) as Resolver<PaymentFormValues>,
    defaultValues: paymentDefaultValues,
  });

  const [proof, setProof] = useState<File | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      form.reset(paymentDefaultValues);
      setProof(null);
      setProofError(null);
    }
  }, [open]);

  function handleProofChange(file: File | undefined) {
    setProofError(null);
    if (!file) return setProof(null);
    if (!ACCEPTED_PROOF_TYPES.includes(file.type)) {
      setProof(null);
      return setProofError("Formato no permitido: usa una imagen JPEG, PNG o WEBP.");
    }
    if (file.size > MAX_PROOF_BYTES) {
      setProof(null);
      return setProofError("La imagen supera los 5 MB.");
    }
    setProof(file);
  }

  function handleSubmit(values: PaymentFormValues) {
    const payload = {
      amount: values.amount,
      method: values.method,
      paidAt: values.paidAt || undefined,
      notes: values.notes || undefined,
      proof: proof ?? undefined,
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
            <div className="space-y-2">
              <Label htmlFor="payment-proof">Comprobante (foto)</Label>
              <Input
                id="payment-proof"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => handleProofChange(e.target.files?.[0])}
              />
              <p className="text-xs text-muted-foreground">
                Opcional: foto de la transferencia o depósito. Una vez guardado el pago, el comprobante no se puede
                cambiar ni eliminar.
              </p>
              {proofError ? <p className="text-sm font-medium text-destructive">{proofError}</p> : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={addPaymentMutation.isPending || proofError !== null}>
                {addPaymentMutation.isPending ? "Guardando..." : "Registrar pago"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
