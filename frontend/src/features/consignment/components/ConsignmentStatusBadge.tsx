import { Badge } from "@/components/ui/badge";
import type { ConsignmentDisplayStatus } from "../consignment.types";

const LABELS: Record<ConsignmentDisplayStatus, string> = {
  EN_CONSIGNACION: "En consignación",
  REVISION_VENCIDA: "Revisión vencida",
  LIQUIDADO_PARCIAL: "Liquidado parcial",
  CERRADO: "Cerrado",
};

const CLASSES: Record<ConsignmentDisplayStatus, string> = {
  EN_CONSIGNACION: "",
  REVISION_VENCIDA: "border-transparent bg-red-100 text-red-800",
  LIQUIDADO_PARCIAL: "border-transparent bg-amber-100 text-amber-800",
  CERRADO: "border-transparent bg-green-100 text-green-800",
};

export function ConsignmentStatusBadge({ status }: { status: ConsignmentDisplayStatus }) {
  return (
    <Badge variant={status === "EN_CONSIGNACION" ? "secondary" : "outline"} className={CLASSES[status]}>
      {LABELS[status]}
    </Badge>
  );
}
