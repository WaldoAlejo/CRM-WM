import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { PaginationMeta } from "@/types/api";
import type { ClaimStatus, CustomerResolution, InsuranceClaim, PendingByCourier } from "./insuranceClaims.types";

const PAGE_SIZE = 20;

export interface InsuranceClaimFilters {
  courierId?: string;
  status?: ClaimStatus;
  customerResolution?: CustomerResolution;
  overdue?: boolean;
  // Para el link directo desde ShipmentSection ("orden → su reclamo") — no
  // hay GET /insurance-claims/:id, así que esto aísla el único resultado vía
  // Shipment.id (InsuranceClaim.shipmentId es @unique).
  shipmentId?: string;
}

function buildQuery(page: number, filters: InsuranceClaimFilters): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.courierId) params.set("courierId", filters.courierId);
  if (filters.status) params.set("status", filters.status);
  if (filters.customerResolution) params.set("customerResolution", filters.customerResolution);
  if (filters.overdue) params.set("overdue", "true");
  if (filters.shipmentId) params.set("shipmentId", filters.shipmentId);
  return params.toString();
}

// pendingByCourier viaja en la MISMA respuesta que el listado paginado (el
// backend lo calcula junto, es un agregado global) — un solo hook, un solo
// request, ningún fetch aparte para el bloque resumen de arriba.
export function useInsuranceClaims(filters: InsuranceClaimFilters) {
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ["insuranceClaims", "list", page, filters],
    queryFn: () =>
      apiFetch<{ data: InsuranceClaim[]; pagination: PaginationMeta; pendingByCourier: PendingByCourier[] }>(
        `/insurance-claims?${buildQuery(page, filters)}`
      ),
  });

  return { page, setPage, pageSize: PAGE_SIZE, query };
}
