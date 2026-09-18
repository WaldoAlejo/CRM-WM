import { useMutation, useQuery } from "@tanstack/react-query";
import { apiFetch, apiFetchBlob } from "@/lib/api";
import type { ChinaRequestLowStock, ChinaRequestSelection } from "./purchasing.types";

export function useChinaRequestLowStock() {
  return useQuery({
    queryKey: ["purchasing", "china-request", "low-stock"],
    queryFn: () => apiFetch<ChinaRequestLowStock>("/purchasing/china-request/low-stock"),
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// Genera el PDF con la selección final. No guarda nada ni toca stock.
export function useDownloadChinaRequestPdf() {
  return useMutation({
    mutationFn: async (items: ChinaRequestSelection[]) => {
      const blob = await apiFetchBlob("/purchasing/china-request/pdf", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      downloadBlob(blob, `solicitud-proveedor-${new Date().toISOString().slice(0, 10)}.pdf`);
      return blob;
    },
  });
}
