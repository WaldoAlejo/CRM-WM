import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ProfitabilityReport } from "./reports.types";

export function useProfitabilityReport(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ["reports", "profitability-detail", dateFrom, dateTo],
    queryFn: () => apiFetch<ProfitabilityReport>(`/reports/profitability?dateFrom=${dateFrom}&dateTo=${dateTo}`),
  });
}
