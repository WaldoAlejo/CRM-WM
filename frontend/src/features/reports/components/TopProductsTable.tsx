import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TopProduct } from "../reports.types";

export function TopProductsTable({ products }: { products: TopProduct[] }) {
  if (products.length === 0) {
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
          <TableHead>Ganancia</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((product) => (
          <TableRow key={product.variantId}>
            <TableCell>{product.sku}</TableCell>
            <TableCell>
              {product.productName}
              {product.label ? <span className="text-muted-foreground"> — {product.label}</span> : null}
            </TableCell>
            <TableCell>{product.unitsSold}</TableCell>
            <TableCell>${product.totalRevenue}</TableCell>
            <TableCell>${product.profit}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
