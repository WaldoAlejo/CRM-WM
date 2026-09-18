import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";

// Los 3 endpoints viven bajo /api/shipments/:id/..., NO anidados bajo
// dispatch-orders (ver shipments.routes.ts) — reportar lo que dice el
// courier es tarea de bodega/logística, cualquier rol autenticado.
// Las 3 respuestas tienen formas distintas entre sí (deliver devuelve
// {shipment, dispatchOrder}, reject devuelve el shipment plano,
// lost-or-damaged devuelve {shipment, insuranceClaim}) y ninguna se usa
// para pintar nada acá — se invalida el detalle de la orden y se deja que
// se refetchee completo con sus includes reales.
export function useShipmentMutations(orderId: string) {
  const queryClient = useQueryClient();

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["dispatchOrders", "detail", orderId] });
    queryClient.invalidateQueries({ queryKey: ["dispatchOrders", "list"] });
  }

  const deliverMutation = useMutation({
    mutationFn: ({ shipmentId, codAmountCollected }: { shipmentId: string; codAmountCollected: number }) =>
      apiFetch(`/shipments/${shipmentId}/deliver`, {
        method: "POST",
        body: JSON.stringify({ codAmountCollected }),
      }),
    onSuccess: () => {
      invalidate();
      toast.success("Envío marcado como entregado");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ shipmentId, rejectionReason }: { shipmentId: string; rejectionReason: string }) =>
      apiFetch(`/shipments/${shipmentId}/reject`, {
        method: "POST",
        body: JSON.stringify({ rejectionReason }),
      }),
    onSuccess: () => {
      invalidate();
      toast.success("Envío marcado como rechazado");
    },
  });

  const lostOrDamagedMutation = useMutation({
    mutationFn: ({ shipmentId, status }: { shipmentId: string; status: "PERDIDO" | "DANADO" }) =>
      apiFetch(`/shipments/${shipmentId}/lost-or-damaged`, {
        method: "POST",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      invalidate();
      toast.success("Envío marcado como perdido/dañado — se generó un reclamo de seguro");
    },
  });

  return { deliverMutation, rejectMutation, lostOrDamagedMutation };
}
