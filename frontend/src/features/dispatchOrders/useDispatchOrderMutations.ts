import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiFetch } from "@/lib/api";
import type { BuyerType, PaymentMethod, PriceType } from "./dispatchOrders.types";

interface CreateOrderItemPayload {
  variantId: string;
  quantity: number;
  priceType: PriceType;
  unitPrice: number;
  discountPct?: number;
}

interface CreateOrderPayload {
  buyerType: BuyerType;
  wholesalerId?: string;
  finalCustomerId?: string;
  shippingProvince: string;
  shippingCity: string;
  paymentMethod: PaymentMethod;
  creditDays?: number;
  notes?: string;
  items: CreateOrderItemPayload[];
}

interface ConfirmOrderPayload {
  courierId?: string;
  trackingNumber?: string;
}

// El body de respuesta de create/confirm/cancel NO es el detalle completo
// (POST /dispatch-orders y /:id/confirm devuelven la orden con `items`
// nomás, sin wholesaler/finalCustomer/payments; /:id/cancel es igual;
// confirmar tampoco trae el courier/claim anidados del shipment recién
// creado) — verificado leyendo dispatchOrders.service.ts, no asumido. Nunca
// se usa ese body para pintar nada: los componentes solo necesitan el `id`
// para navegar, y dejan que la invalidación dispare un refetch real de GET
// /dispatch-orders/:id (esa sí trae todo con los includes correctos).
interface MutationResult {
  id: string;
}

export function useDispatchOrderMutations() {
  const queryClient = useQueryClient();

  function invalidateList() {
    queryClient.invalidateQueries({ queryKey: ["dispatchOrders", "list"] });
  }
  function invalidateDetail(id: string) {
    queryClient.invalidateQueries({ queryKey: ["dispatchOrders", "detail", id] });
  }

  const createMutation = useMutation({
    mutationFn: (values: CreateOrderPayload) =>
      apiFetch<MutationResult>("/dispatch-orders", { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => invalidateList(),
  });

  const confirmMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ConfirmOrderPayload }) =>
      apiFetch<MutationResult>(`/dispatch-orders/${id}/confirm`, {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: (_, { id }) => {
      invalidateList();
      invalidateDetail(id);
      toast.success("Orden confirmada correctamente");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiFetch<MutationResult>(`/dispatch-orders/${id}/cancel`, { method: "POST" }),
    onSuccess: (_, id) => {
      invalidateList();
      invalidateDetail(id);
      toast.success("Orden cancelada correctamente");
    },
    // Cancelar es un ConfirmDeleteDialog-style (sin formulario propio):
    // necesita su propio toast, no hay a quién más pasarle el error.
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : "No se pudo cancelar la orden. Intenta de nuevo.";
      toast.error(message);
    },
  });

  return { createMutation, confirmMutation, cancelMutation };
}
