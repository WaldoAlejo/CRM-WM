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
import { updateClaimStatusDefaultValues, updateClaimStatusSchema } from "../insuranceClaims.schema";
import type { UpdateClaimStatusFormValues } from "../insuranceClaims.schema";
import { useInsuranceClaimMutations } from "../useInsuranceClaimMutations";

interface UpdateClaimStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claimId: string;
}

export function UpdateClaimStatusDialog({ open, onOpenChange, claimId }: UpdateClaimStatusDialogProps) {
  const { updateStatusMutation } = useInsuranceClaimMutations();

  const form = useForm<UpdateClaimStatusFormValues>({
    resolver: zodResolver(updateClaimStatusSchema) as Resolver<UpdateClaimStatusFormValues>,
    defaultValues: updateClaimStatusDefaultValues,
  });

  useEffect(() => {
    if (open) form.reset(updateClaimStatusDefaultValues);
  }, [open]);

  function handleSubmit(values: UpdateClaimStatusFormValues) {
    const payload = { status: values.status, reimbursedAmount: values.reimbursedAmount };
    updateStatusMutation
      .mutateAsync({ id: claimId, payload })
      .then(() => onOpenChange(false))
      .catch((error: unknown) => applyApiErrorToForm(error, form));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Actualizar estado del reclamo</DialogTitle>
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
                      <SelectItem value="EN_REVISION">En revisión</SelectItem>
                      <SelectItem value="APROBADO">Aprobado</SelectItem>
                      <SelectItem value="RECHAZADO">Rechazado</SelectItem>
                      <SelectItem value="PAGADO">Pagado</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reimbursedAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monto reembolsado por el courier</FormLabel>
                  <FormControl>
                    <Input type="number" min={0} step="any" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={updateStatusMutation.isPending}>
                {updateStatusMutation.isPending ? "Guardando..." : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
