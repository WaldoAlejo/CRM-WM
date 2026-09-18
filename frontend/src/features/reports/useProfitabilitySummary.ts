import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ProfitabilitySummary } from "./reports.types";

export function useProfitabilitySummary(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ["reports", "profitability-summary", dateFrom, dateTo],
    queryFn: () =>
      apiFetch<ProfitabilitySummary>(`/reports/profitability/summary?dateFrom=${dateFrom}&dateTo=${dateTo}`),
  });
}
