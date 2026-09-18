import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ProfitabilityLine } from "../reports.types";

export function ProfitabilityLinesTable({ lines }: { lines: ProfitabilityLine[] }) {
  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin datos en este rango.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>SKU</TableHead>
          <TableHead>Producto</TableHead>
          <TableHead>Unidades</TableHead>
          <TableHead>Revenue</TableHead>
          <TableHead>Costo</TableHead>
          <TableHead>Ganancia</TableHead>
          <TableHead>Margen</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <TableRow key={line.variantId}>
            <TableCell>{line.sku}</TableCell>
            <TableCell>
              {line.productName}
              {line.label ? <span className="text-muted-foreground"> — {line.label}</span> : null}
            </TableCell>
            <TableCell>{line.unitsSold}</TableCell>
            <TableCell>${line.totalRevenue}</TableCell>
            <TableCell>${line.totalCost}</TableCell>
            <TableCell>${line.profit}</TableCell>
            <TableCell>{line.profitMarginPct}%</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
