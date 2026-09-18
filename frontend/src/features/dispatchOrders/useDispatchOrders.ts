import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { PaginationMeta } from "@/types/api";
import type { BuyerType, DispatchOrderListItem, DispatchStatus, PaymentMethod } from "./dispatchOrders.types";

const PAGE_SIZE = 20;

export interface DispatchOrderFilters {
  status?: DispatchStatus;
  paymentMethod?: PaymentMethod;
  buyerType?: BuyerType;
  shippingProvince?: string;
  dateFrom?: string;
  dateTo?: string;
}

function buildQuery(page: number, filters: DispatchOrderFilters): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.status) params.set("status", filters.status);
  if (filters.paymentMethod) params.set("paymentMethod", filters.paymentMethod);
  if (filters.buyerType) params.set("buyerType", filters.buyerType);
  if (filters.shippingProvince) params.set("shippingProvince", filters.shippingProvince);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  return params.toString();
}

export function useDispatchOrders(filters: DispatchOrderFilters) {
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ["dispatchOrders", "list", page, filters],
    queryFn: () =>
      apiFetch<{ data: DispatchOrderListItem[]; pagination: PaginationMeta }>(
        `/dispatch-orders?${buildQuery(page, filters)}`
      ),
  });

  return { page, setPage, pageSize: PAGE_SIZE, query };
}
