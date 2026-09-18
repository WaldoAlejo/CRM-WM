import { DataTable } from "@/components/crud/DataTable";
import type { CrudColumn } from "@/components/crud/types";
import { usePricingVisibility } from "@/hooks/usePricingVisibility";
import type { DispatchOrderCostField } from "@/lib/dispatchOrderCostFields";
import type { DispatchOrderItem } from "../dispatchOrders.types";

// Tipado contra DispatchOrderCostField (no un string suelto): si el backend
// renombra unitCostSnapshot/landedCostSnapshot en su serializer, TS marca
// acá el desajuste en vez de dejarlo pasar silencioso — mismo criterio que
// PRICE_FIELDS_CONFIG en VariantFormDialog.
const COST_COLUMNS_CONFIG: { field: DispatchOrderCostField; header: string }[] = [
  { field: "unitCostSnapshot", header: "Costo unitario" },
  { field: "landedCostSnapshot", header: "Costo aterrizaje" },
];

function money(value: string | null | undefined): string {
  return value ? `$${value}` : "—";
}

function lineSubtotal(item: DispatchOrderItem): number {
  const unitPrice = Number(item.unitPrice);
  const discountPct = item.discountPct ? Number(item.discountPct) : 0;
  return unitPrice * item.quantity * (1 - discountPct / 100);
}

export function OrderDetailItemsTable({ items }: { items: DispatchOrderItem[] }) {
  // Mismo mecanismo que VariantsTable/dispatchOrders.serializer.ts: las
  // columnas de costo directamente no se agregan al array si el rol no
  // puede verlas — usa usePricingVisibility (role===ADMIN) porque
  // dispatchOrders.serializer.ts oculta unitCostSnapshot/landedCostSnapshot
  // con el mismo criterio "solo ADMIN" que PRICING_FIELDS, aunque sean
  // campos distintos (ver dispatchOrderCostFields.ts).
  const canSeeCosts = usePricingVisibility();

  const columns: CrudColumn<DispatchOrderItem>[] = [
    {
      header: "Producto",
      cell: (item) => (
        <div>
          <p className="font-medium">{item.variant.sku}</p>
          {item.variant.label ? <p className="text-xs text-muted-foreground">{item.variant.label}</p> : null}
        </div>
      ),
    },
    { header: "Cantidad", cell: (item) => item.quantity },
    { header: "Tipo", cell: (item) => (item.priceType === "MAYORISTA" ? "Mayorista" : "PVP") },
    { header: "P. Unit.", cell: (item) => money(item.unitPrice) },
    { header: "Desc. %", cell: (item) => (item.discountPct ? `${item.discountPct}%` : "—") },
    { header: "Subtotal", cell: (item) => `$${lineSubtotal(item).toFixed(2)}` },
    ...(canSeeCosts
      ? (COST_COLUMNS_CONFIG.map((config) => ({
          header: config.header,
          cell: (item: DispatchOrderItem) => money(item[config.field]),
        })) satisfies CrudColumn<DispatchOrderItem>[])
      : []),
  ];

  return <DataTable columns={columns} data={items} isLoading={false} getRowId={(item) => item.id} />;
}
