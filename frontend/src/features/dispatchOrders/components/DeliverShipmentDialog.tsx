import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import type { Resolver } from "react-hook-form";
import { useForm } from "react-hook-form";
import { applyApiErrorToForm } from "@/components/crud/applyApiErrorToForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { deliverShipmentDefaultValues, deliverShipmentSchema } from "../shipments.schema";
import type { DeliverShipmentFormValues } from "../shipments.schema";
import { useShipmentMutations } from "../useShipmentMutations";

interface DeliverShipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  shipmentId: string;
}

export function DeliverShipmentDialog({ open, onOpenChange, orderId, shipmentId }: DeliverShipmentDialogProps) {
  const { deliverMutation } = useShipmentMutations(orderId);

  const form = useForm<DeliverShipmentFormValues>({
    resolver: zodResolver(deliverShipmentSchema) as Resolver<DeliverShipmentFormValues>,
    defaultValues: deliverShipmentDefaultValues,
  });

  useEffect(() => {
    if (open) form.reset(deliverShipmentDefaultValues);
  }, [open]);

  function handleSubmit(values: DeliverShipmentFormValues) {
    deliverMutation
      .mutateAsync({ shipmentId, codAmountCollected: values.codAmountCollected })
      .then(() => onOpenChange(false))
      .catch((error: unknown) => applyApiErrorToForm(error, form));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar envío como entregado</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="codAmountCollected"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monto cobrado contra entrega</FormLabel>
                  <FormControl>
                    <Input type="number" min={0} step="any" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={deliverMutation.isPending}>
                {deliverMutation.isPending ? "Guardando..." : "Marcar entregado"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
