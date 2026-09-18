import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import type { Resolver } from "react-hook-form";
import { useForm } from "react-hook-form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { applyApiErrorToForm } from "@/components/crud/applyApiErrorToForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { confirmContraEntregaSchema } from "../dispatchOrders.schema";
import type { ConfirmContraEntregaFormValues } from "../dispatchOrders.schema";
import type { PaymentMethod } from "../dispatchOrders.types";
import { useCourierOptions } from "../useCourierOptions";
import { useDispatchOrderMutations } from "../useDispatchOrderMutations";

interface ConfirmOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  paymentMethod: PaymentMethod;
}

// CONTRA_ENTREGA es el único caso en que el backend exige courierId — para
// el resto, confirmar es una simple pregunta sin campos (AlertDialog), no
// vale la pena montar un Dialog con formulario para nada.
export function ConfirmOrderDialog({ open, onOpenChange, orderId, paymentMethod }: ConfirmOrderDialogProps) {
  const { confirmMutation } = useDispatchOrderMutations();
  const { data: couriers } = useCourierOptions();
  const needsCourier = paymentMethod === "CONTRA_ENTREGA";

  const form = useForm<ConfirmContraEntregaFormValues>({
    resolver: zodResolver(confirmContraEntregaSchema) as Resolver<ConfirmContraEntregaFormValues>,
    defaultValues: { courierId: "", trackingNumber: "" },
  });

  useEffect(() => {
    if (open) form.reset({ courierId: "", trackingNumber: "" });
  }, [open]);

  function handleConfirm(values: ConfirmContraEntregaFormValues) {
    confirmMutation
      .mutateAsync({ id: orderId, values: needsCourier ? values : {} })
      .then(() => onOpenChange(false))
      .catch((error: unknown) => applyApiErrorToForm(error, form));
  }

  if (!needsCourier) {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Confirmar esta orden?</AlertDialogTitle>
            <AlertDialogDescription>
              Se descuenta el stock reservado y la orden pasa a DESPACHADO.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleConfirm({ courierId: "", trackingNumber: "" });
              }}
              disabled={confirmMutation.isPending}
            >
              {confirmMutation.isPending ? "Confirmando..." : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar orden — contra entrega</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleConfirm)} className="grid gap-4">
            <FormField
              control={form.control}
              name="courierId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Courier</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Elegí un courier" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {couriers?.map((courier) => (
                        <SelectItem key={courier.id} value={courier.id}>
                          {courier.name}
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
              name="trackingNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Número de guía</FormLabel>
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
              <Button type="submit" disabled={confirmMutation.isPending}>
                {confirmMutation.isPending ? "Confirmando..." : "Confirmar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
