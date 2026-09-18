import { Trash2Icon } from "lucide-react";
import type { Control, FieldArrayWithId, FieldErrors } from "react-hook-form";
import { useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWarehouseOptions } from "@/features/warehouses/useWarehouseOptions";
import type { DispatchOrderFormValues } from "../dispatchOrders.schema";

interface OrderItemsTableProps {
  control: Control<DispatchOrderFormValues>;
  errors: FieldErrors<DispatchOrderFormValues>;
  // `fields`/`remove` vienen de un ÚNICO useFieldArray en el padre (que
  // también necesita `append` para lo que agrega VariantSearchAdd) — llamar
  // useFieldArray una segunda vez acá sería una suscripción redundante al
  // mismo array.
  fields: FieldArrayWithId<DispatchOrderFormValues, "items", "id">[];
  remove: (index: number) => void;
}

function lineSubtotal(unitPrice: number, quantity: number, discountPct: number | undefined): number {
  return unitPrice * quantity * (1 - (discountPct ?? 0) / 100);
}

// La tabla de líneas del borrador: no es un CrudColumn genérico porque cada
// fila edita 4 campos a la vez (quantity/priceType/unitPrice/discountPct) y
// muestra el aviso de stock — no encaja en "una celda, un valor de solo
// lectura".
export function OrderItemsTable({ control, errors, fields, remove }: OrderItemsTableProps) {
  const items = useWatch({ control, name: "items" }) ?? [];
  const { data: warehouses } = useWarehouseOptions();
  // Selector plano de ubicaciones activas, con el nombre de la bodega
  // delante (ej. "Bodega Central · A-3-2") — hoy hay una sola bodega, pero
  // esto ya soporta que haya varias sin cambiar el selector.
  const locationOptions = (warehouses ?? []).flatMap((w) =>
    w.locations.map((l) => ({ id: l.id, label: `${w.name} · ${l.code}` }))
  );

  // Mismo chequeo defensivo que AttributesFieldArray: el error de "agregá al
  // menos un ítem" (.min(1) del array completo) puede quedar en .root o
  // directo en el objeto del array según cómo lo reporte el resolver.
  const arrayLevelError =
    (errors.items as { root?: { message?: string }; message?: string } | undefined)?.root?.message ??
    (errors.items as { message?: string } | undefined)?.message;

  const total = items.reduce(
    (sum, item) => sum + lineSubtotal(item.unitPrice ?? 0, item.quantity ?? 0, item.discountPct),
    0
  );

  if (fields.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Todavía no agregaste ningún ítem.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Producto</TableHead>
            <TableHead className="w-24">Cantidad</TableHead>
            <TableHead className="w-28">Tipo</TableHead>
            <TableHead className="w-28">P. Unit.</TableHead>
            <TableHead className="w-24">Desc. %</TableHead>
            <TableHead className="w-40">Ubicación</TableHead>
            <TableHead className="w-28">Subtotal</TableHead>
            <TableHead className="w-32">Stock</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map((field, index) => {
            const item = items[index];
            const overStock = item && item.quantity > item.availableStockAtAdd;
            return (
              <TableRow key={field.id}>
                <TableCell>
                  <p className="font-medium">{item?.sku}</p>
                  {item?.label ? <p className="text-xs text-muted-foreground">{item.label}</p> : null}
                </TableCell>
                <TableCell>
                  <FormField
                    control={control}
                    name={`items.${index}.quantity`}
                    render={({ field: f }) => (
                      <FormItem>
                        <FormControl>
                          <Input type="number" min={1} step={1} {...f} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TableCell>
                <TableCell>
                  <FormField
                    control={control}
                    name={`items.${index}.priceType`}
                    render={({ field: f }) => (
                      <FormItem>
                        <Select value={f.value} onValueChange={f.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="MAYORISTA">Mayorista</SelectItem>
                            <SelectItem value="PVP">PVP</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TableCell>
                <TableCell>
                  <FormField
                    control={control}
                    name={`items.${index}.unitPrice`}
                    render={({ field: f }) => (
                      <FormItem>
                        <FormControl>
                          <Input type="number" min={0} step="any" {...f} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TableCell>
                <TableCell>
                  <FormField
                    control={control}
                    name={`items.${index}.discountPct`}
                    render={({ field: f }) => (
                      <FormItem>
                        <FormControl>
                          <Input type="number" min={0} max={100} step="any" {...f} value={f.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TableCell>
                <TableCell>
                  <FormField
                    control={control}
                    name={`items.${index}.locationId`}
                    render={({ field: f }) => (
                      <FormItem>
                        <Select
                          value={f.value ?? "none"}
                          onValueChange={(value) => f.onChange(value === "none" ? undefined : value)}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Sin especificar" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="none">Sin especificar</SelectItem>
                            {locationOptions.map((loc) => (
                              <SelectItem key={loc.id} value={loc.id}>
                                {loc.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TableCell>
                <TableCell className="text-sm">
                  ${lineSubtotal(item?.unitPrice ?? 0, item?.quantity ?? 0, item?.discountPct).toFixed(2)}
                </TableCell>
                <TableCell>
                  {/* Aviso, no bloqueo: el backend sigue siendo la
                      validación real al confirmar/crear — esto es solo la
                      foto de stock capturada al agregar la línea. */}
                  <span className={overStock ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
                    {overStock ? "⚠ " : ""}
                    {item?.availableStockAtAdd} disp.
                  </span>
                </TableCell>
                <TableCell>
                  <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} title="Quitar ítem">
                    <Trash2Icon />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {arrayLevelError ? <p className="text-sm font-medium text-destructive">{arrayLevelError}</p> : null}

      <p className="text-right text-sm font-medium">Total: ${total.toFixed(2)}</p>
    </div>
  );
}
