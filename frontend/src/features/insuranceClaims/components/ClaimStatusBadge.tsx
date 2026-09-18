import { Badge } from "@/components/ui/badge";
import type { ClaimStatus } from "../insuranceClaims.types";

const LABELS: Record<ClaimStatus, string> = {
  PENDIENTE: "Pendiente",
  EN_REVISION: "En revisión",
  APROBADO: "Aprobado",
  RECHAZADO: "Rechazado",
  PAGADO: "Pagado",
};

// PENDIENTE/EN_REVISION: sigue abierto (secondary, neutro). APROBADO/PAGADO:
// resuelto a favor (verde). RECHAZADO: resuelto en contra (destructive).
const EXTRA_CLASS: Partial<Record<ClaimStatus, string>> = {
  APROBADO: "border-transparent bg-green-100 text-green-800",
  PAGADO: "border-transparent bg-green-100 text-green-800",
};

export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  if (status === "RECHAZADO") return <Badge variant="destructive">{LABELS[status]}</Badge>;
  return (
    <Badge variant={EXTRA_CLASS[status] ? "outline" : "secondary"} className={EXTRA_CLASS[status]}>
      {LABELS[status]}
    </Badge>
  );
}
