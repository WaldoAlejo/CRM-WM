import { useQuery } from "@tanstack/react-query";
import { landedUnitCost } from "@/features/importBatches/landedCost";
import { apiFetch } from "@/lib/api";

interface LatestIngresoMovement {
  unitCost?: string | null;
  landedCostPerUnit?: string | null;
}

// Costo aterrizado de la ÚLTIMA recepción de esta variante (no un promedio):
// el movimiento INGRESO más reciente, tal cual pide la calculadora standalone.
// unitCost/landedCostPerUnit son opcionales en el tipo porque el backend
// directamente no los manda para OPERATOR (ver inventory.movementSerializer.ts)
// — por eso `enabled` exige además que el llamante pueda ver precios.
export function useLatestLandedCost(variantId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["inventory", "movements", "latest-ingreso", variantId],
    queryFn: async () => {
      const res = await apiFetch<{ data: LatestIngresoMovement[] }>(
        `/inventory/movements?variantId=${variantId}&type=INGRESO&page=1&pageSize=1`
      );
      const last = res.data[0];
      if (!last || last.unitCost == null) return null;
      return landedUnitCost(Number(last.unitCost), Number(last.landedCostPerUnit ?? 0));
    },
    enabled,
  });
}
