import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";

interface AddPaymentPayload {
  amount: number;
  method: string;
  paidAt?: string;
  notes?: string;
  // Foto de comprobante (opcional). Una vez guardada no se puede editar ni borrar.
  proof?: File;
}

// POST /:id/payments devuelve el resultado crudo de
// recalculatePaymentStatus (un dispatchOrder.update sin includes) — igual
// que las mutaciones de la orden, no se usa ese body para pintar nada, solo
// se invalida el detalle para que se refetchee completo.
export function usePaymentMutations(orderId: string) {
  const queryClient = useQueryClient();

  const addPaymentMutation = useMutation({
    mutationFn: ({ proof, ...values }: AddPaymentPayload) => {
      // Con foto viaja como multipart (apiFetch NO fija Content-Type para
      // FormData: lo arma el browser con el boundary); sin foto, JSON como siempre.
      let body: BodyInit;
      if (proof) {
        const form = new FormData();
        for (const [key, value] of Object.entries(values)) {
          if (value !== undefined) form.append(key, String(value));
        }
        form.append("proof", proof);
        body = form;
      } else {
        body = JSON.stringify(values);
      }
      return apiFetch<{ id: string }>(`/dispatch-orders/${orderId}/payments`, { method: "POST", body });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatchOrders", "detail", orderId] });
      queryClient.invalidateQueries({ queryKey: ["dispatchOrders", "list"] });
      toast.success("Pago registrado correctamente");
    },
  });

  return { addPaymentMutation };
}
