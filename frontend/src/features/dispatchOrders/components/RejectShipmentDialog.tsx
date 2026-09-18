import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import type { Resolver } from "react-hook-form";
import { useForm } from "react-hook-form";
import { applyApiErrorToForm } from "@/components/crud/applyApiErrorToForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { rejectShipmentDefaultValues, rejectShipmentSchema } from "../shipments.schema";
import type { RejectShipmentFormValues } from "../shipments.schema";
import { useShipmentMutations } from "../useShipmentMutations";

interface RejectShipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  shipmentId: string;
}

export function RejectShipmentDialog({ open, onOpenChange, orderId, shipmentId }: RejectShipmentDialogProps) {
  const { rejectMutation } = useShipmentMutations(orderId);

  const form = useForm<RejectShipmentFormValues>({
    resolver: zodResolver(rejectShipmentSchema) as Resolver<RejectShipmentFormValues>,
    defaultValues: rejectShipmentDefaultValues,
  });

  useEffect(() => {
    if (open) form.reset(rejectShipmentDefaultValues);
  }, [open]);

  function handleSubmit(values: RejectShipmentFormValues) {
    rejectMutation
      .mutateAsync({ shipmentId, rejectionReason: values.rejectionReason })
      .then(() => onOpenChange(false))
      .catch((error: unknown) => applyApiErrorToForm(error, form));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar envío como rechazado</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="rejectionReason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo de rechazo</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={rejectMutation.isPending}>
                {rejectMutation.isPending ? "Guardando..." : "Marcar rechazado"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
