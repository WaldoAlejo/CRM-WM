import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import type { Resolver } from "react-hook-form";
import { useForm } from "react-hook-form";
import { applyApiErrorToForm } from "@/components/crud/applyApiErrorToForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { lostOrDamagedShipmentDefaultValues, lostOrDamagedShipmentSchema } from "../shipments.schema";
import type { LostOrDamagedShipmentFormValues } from "../shipments.schema";
import { useShipmentMutations } from "../useShipmentMutations";

interface LostOrDamagedShipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  shipmentId: string;
}

export function LostOrDamagedShipmentDialog({
  open,
  onOpenChange,
  orderId,
  shipmentId,
}: LostOrDamagedShipmentDialogProps) {
  const { lostOrDamagedMutation } = useShipmentMutations(orderId);

  const form = useForm<LostOrDamagedShipmentFormValues>({
    resolver: zodResolver(lostOrDamagedShipmentSchema) as Resolver<LostOrDamagedShipmentFormValues>,
    defaultValues: lostOrDamagedShipmentDefaultValues,
  });

  useEffect(() => {
    if (open) form.reset(lostOrDamagedShipmentDefaultValues);
  }, [open]);

  function handleSubmit(values: LostOrDamagedShipmentFormValues) {
    lostOrDamagedMutation
      .mutateAsync({ shipmentId, status: values.status })
      .then(() => onOpenChange(false))
      .catch((error: unknown) => applyApiErrorToForm(error, form));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar envío como perdido/dañado</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estado</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="PERDIDO">Perdido</SelectItem>
                      <SelectItem value="DANADO">Dañado</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className="text-sm text-muted-foreground">
              Esto genera automáticamente un reclamo de seguro pendiente por el valor de venta de los ítems.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={lostOrDamagedMutation.isPending}>
                {lostOrDamagedMutation.isPending ? "Guardando..." : "Confirmar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
