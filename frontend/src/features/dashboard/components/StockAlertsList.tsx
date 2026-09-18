import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StockAlertItem } from "../dashboard.types";

// Solo el top 5 (lo que ya manda el backend, ver getStockAlerts en
// dashboard.service.ts) — el listado completo vive en
// /inventory/low-stock, adonde apunta "Ver todos".
export function StockAlertsList({ count, items }: { count: number; items: StockAlertItem[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Stock bajo</CardTitle>
        {count > 0 ? (
          <Link to="/inventory/low-stock" className="text-sm text-primary hover:underline">
            Ver todos ({count})
          </Link>
        ) : null}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin alertas de stock bajo.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.variantId} className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium">{item.sku}</p>
                  <p className="text-xs text-muted-foreground">{item.productName}</p>
                </div>
                <span className="font-medium text-destructive">
                  {item.stock} / {item.minStock}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
