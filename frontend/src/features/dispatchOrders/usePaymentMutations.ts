import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";

interface AddPaymentPayload {
  amount: number;
  method: string;
  paidAt?: string;
  notes?: string;
}

// POST /:id/payments devuelve el resultado crudo de
// recalculatePaymentStatus (un dispatchOrder.update sin includes) — igual
// que las mutaciones de la orden, no se usa ese body para pintar nada, solo
// se invalida el detalle para que se refetchee completo.
export function usePaymentMutations(orderId: string) {
  const queryClient = useQueryClient();

  const addPaymentMutation = useMutation({
    mutationFn: (values: AddPaymentPayload) =>
      apiFetch<{ id: string }>(`/dispatch-orders/${orderId}/payments`, {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatchOrders", "detail", orderId] });
      queryClient.invalidateQueries({ queryKey: ["dispatchOrders", "list"] });
      toast.success("Pago registrado correctamente");
    },
  });

  return { addPaymentMutation };
}
