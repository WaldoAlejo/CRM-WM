import { Badge } from "@/components/ui/badge";
import type { PaymentStatus } from "../dispatchOrders.types";

const LABELS: Record<PaymentStatus, string> = {
  PENDIENTE: "Pago pendiente",
  PARCIAL: "Pago parcial",
  PAGADO: "Pagado",
};

// PARCIAL/PAGADO no mapean bien a los 4 variants genéricos de Badge (ninguno
// es "amber" ni "verde") — se les da un className puntual encima en vez de
// forzar un variant que no comunica lo mismo.
const EXTRA_CLASS: Record<PaymentStatus, string> = {
  PENDIENTE: "",
  PARCIAL: "border-transparent bg-amber-100 text-amber-800",
  PAGADO: "border-transparent bg-green-100 text-green-800",
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <Badge variant={status === "PENDIENTE" ? "secondary" : "outline"} className={EXTRA_CLASS[status]}>
      {LABELS[status]}
    </Badge>
  );
}
