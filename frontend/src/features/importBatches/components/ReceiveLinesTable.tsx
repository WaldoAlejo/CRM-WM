import { WarehouseLocationSelect } from "@/features/locations/WarehouseLocationSelect";
import { Trash2Icon } from "lucide-react";
import type { ArrayPath, Control, FieldArrayWithId, FieldErrors, FieldValues, Path } from "react-hook-form";
import { useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ReceiveLineFormValues } from "../importBatches.schema";
import { landedUnitCost, volumeCostPerUnit } from "../landedCost";

// Tanto la pantalla de "nuevo lote" como la de "recibir más mercadería"
// comparten esta tabla: solo cambia el form que la contiene, y ambos tienen
// un campo `lines` con la misma forma.
interface FormWithLines extends FieldValues {
  lines: ReceiveLineFormValues[];
}

interface ReceiveLinesTableProps<T extends FormWithLines> {
  control: Control<T>;
  errors: FieldErrors<T>;
  fields: FieldArrayWithId<T, ArrayPath<T>, "id">[];
  remove: (index: number) => void;
  // Prorrateo por unidad ya calculado (null = no mostrar costo puesto: es
  // OPERATOR, que ni siquiera ve costos del lote).
  costPerCbm: number | null;
  disabled?: boolean;
}

export function ReceiveLinesTable<T extends FormWithLines>({
  control,
  errors,
  fields,
  remove,
  costPerCbm,
  disabled,
}: ReceiveLinesTableProps<T>) {
  const lines = (useWatch({ control, name: "lines" as Path<T> }) as ReceiveLineFormValues[] | undefined) ?? [];

  const arrayLevelError =
    (errors.lines as { root?: { message?: string }; message?: string } | undefined)?.root?.message ??
    (errors.lines as { message?: string } | undefined)?.message;

  if (fields.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Todavía no agregaste ninguna línea.
        {arrayLevelError ? <p className="mt-2 font-medium text-destructive">{arrayLevelError}</p> : null}
      </div>
    );
  }

  const showLanded = costPerCbm !== null;

  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Producto</TableHead>
            <TableHead className="w-24">Cantidad</TableHead>
            <TableHead className="w-32">Costo unitario en origen (USD)</TableHead>
            <TableHead>CBM totales de la línea</TableHead>
            {showLanded ? <><TableHead>Gastos de la línea (USD)</TableHead><TableHead className="w-32">Costo puesto / unidad (USD)</TableHead></> : null}
            <TableHead className="w-48">Bodega y ubicación</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map((field, index) => {
            const line = lines[index];
            const landed = showLanded ? landedUnitCost(Number(line?.unitCost ?? 0) || 0, volumeCostPerUnit(costPerCbm!, Number(line?.volumeCbm) || 0, Number(line?.quantity) || 0)) : null;
            return (
              <TableRow key={field.id}>
                <TableCell>
                  <p className="font-medium">{line?.sku}</p>
                  <p className="text-xs text-muted-foreground">
                    {line?.productName}
                    {line?.label ? ` — ${line.label}` : ""}
                  </p>
                </TableCell>
                <TableCell>
                  <FormField
                    control={control}
                    name={`lines.${index}.quantity` as Path<T>}
                    render={({ field: f }) => (
                      <FormItem>
                        <FormControl>
                          <Input type="number" min={1} step={1} aria-label={`Cantidad ${line?.sku}`} disabled={disabled} {...f} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TableCell>
                <TableCell>
                  <FormField
                    control={control}
                    name={`lines.${index}.unitCost` as Path<T>}
                    render={({ field: f }) => (
                      <FormItem>
                        <FormControl>
                          <Input type="number" min={0} step="any" aria-label={`Costo unitario ${line?.sku}`} disabled={disabled} {...f} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TableCell>
                <TableCell><FormField control={control} name={`lines.${index}.volumeCbm` as Path<T>} render={({ field: f }) => (
                  <FormItem><FormControl><Input type="number" min="0.000001" step="any" aria-label={`CBM totales ${line?.sku}`} disabled={disabled} {...f} /></FormControl><FormMessage /></FormItem>
                )} /></TableCell>
                {showLanded ? (
                  <><TableCell>${((costPerCbm ?? 0) * (Number(line?.volumeCbm) || 0)).toFixed(2)}</TableCell><TableCell className="text-sm font-medium">${landed?.toFixed(2)}</TableCell></>
                ) : null}
                <TableCell>
                  <FormField
                    control={control}
                    name={`lines.${index}.locationId` as Path<T>}
                    render={({ field: f }) => (
                      <FormItem>
                        <WarehouseLocationSelect value={f.value as string | undefined} onChange={id => f.onChange(id ?? "")} required label={line?.sku ?? "producto"} disabled={disabled} />
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    onClick={() => remove(index)}
                    title="Quitar línea"
                  >
                    <Trash2Icon />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {arrayLevelError ? <p className="text-sm font-medium text-destructive">{arrayLevelError}</p> : null}
    </div>
  );
}
