import { Badge } from "@/components/ui/badge";
import type { DispatchStatus } from "../dispatchOrders.types";

const LABELS: Record<DispatchStatus, string> = {
  PENDIENTE: "Pendiente",
  DESPACHADO: "Despachado",
  CANCELADO: "Cancelado",
};

const VARIANTS: Record<DispatchStatus, "secondary" | "default" | "destructive"> = {
  PENDIENTE: "secondary",
  DESPACHADO: "default",
  CANCELADO: "destructive",
};

export function DispatchStatusBadge({ status }: { status: DispatchStatus }) {
  return <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>;
}
