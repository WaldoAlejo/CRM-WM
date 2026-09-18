import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { CrudColumn } from "./types";

interface DataTableProps<TItem> {
  columns: CrudColumn<TItem>[];
  data: TItem[];
  isLoading: boolean;
  getRowId: (item: TItem) => string;
  actions?: (item: TItem) => ReactNode;
  // Opcional: para resaltar una fila completa (ej. "vencido") de forma
  // visual sin depender de que el usuario note un badge en una sola celda.
  rowClassName?: (item: TItem) => string | undefined;
}

export function DataTable<TItem>({ columns, data, isLoading, getRowId, actions, rowClassName }: DataTableProps<TItem>) {
  const columnCount = columns.length + (actions ? 1 : 0);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.header} className={column.className}>
              {column.header}
            </TableHead>
          ))}
          {actions ? <TableHead className="w-24 text-right">Acciones</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={`skeleton-${i}`}>
              {Array.from({ length: columnCount }).map((_, j) => (
                <TableCell key={j}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : data.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columnCount} className="h-24 text-center text-muted-foreground">
              No hay resultados.
            </TableCell>
          </TableRow>
        ) : (
          data.map((item) => (
            <TableRow key={getRowId(item)} className={cn(rowClassName?.(item))}>
              {columns.map((column) => (
                <TableCell key={column.header} className={column.className}>
                  {column.cell(item)}
                </TableCell>
              ))}
              {actions ? <TableCell className="text-right">{actions(item)}</TableCell> : null}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
