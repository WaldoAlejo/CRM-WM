import { Badge } from "@/components/ui/badge";
import type { ClaimStatus } from "../insuranceClaims.types";

// Mismo criterio que `overdue` en insuranceClaims.service.ts: vencido =
// expectedResolutionDate ya pasó Y el reclamo sigue sin cerrarse ante el
// courier (ni aprobado, ni pagado, ni rechazado). Se muestra siempre que
// aplique, sin depender de que el filtro "overdue" esté activado — visual,
// no algo que haya que ir a buscar.
export function isClaimOverdue(status: ClaimStatus, expectedResolutionDate: string): boolean {
  const isClosed = status === "APROBADO" || status === "PAGADO" || status === "RECHAZADO";
  return !isClosed && new Date(expectedResolutionDate).getTime() < Date.now();
}

export function OverdueBadge({ status, expectedResolutionDate }: { status: ClaimStatus; expectedResolutionDate: string }) {
  if (!isClaimOverdue(status, expectedResolutionDate)) return null;
  return <Badge variant="destructive">Vencido</Badge>;
}
