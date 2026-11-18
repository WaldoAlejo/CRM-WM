import { WarehouseLocationSelect } from "@/features/locations/WarehouseLocationSelect";
import { negotiatedPrice } from "../negotiatedPricing";
import type { DispatchOrderItemFormValues } from "../dispatchOrders.schema";
import { Trash2Icon } from "lucide-react";
import type { Control, FieldArrayWithId, FieldErrors } from "react-hook-form";
import { useFormContext, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

const round2 = (n: number) => Math.round(n * 100) / 100;

function ivaFactor(item: DispatchOrderItemFormValues, includeIva: boolean): number {
  return includeIva ? 1 + (item.ivaRateAtAdd ?? 0) / 100 : 1;
}

// Precio tal como se ve y se escribe en la fila: con IVA si la casilla
// "Precios con IVA incluido" está marcada. El total real lo calcula el servidor.
function unitPrice(item: DispatchOrderItemFormValues, includeIva: boolean): number {
  if (item.costBased && !item.priceTyped) {
    return round2(negotiatedPrice(item.costAtAdd ?? 0, Number(item.markupPct) || 0) * ivaFactor(item, includeIva));
  }
  return Number(item.unitPrice) || 0;
}

// Precio sin IVA (solo filas con incremento sobre costo, que conocen su tasa).
function netPrice(item: DispatchOrderItemFormValues, includeIva: boolean): number {
  return round2(unitPrice(item, includeIva) / ivaFactor(item, includeIva));
}

// Incremento que resulta de un precio escrito a mano (mismo cálculo que el servidor).
function markupFromPrice(item: DispatchOrderItemFormValues, includeIva: boolean): number {
  const cost = item.costAtAdd ?? 0;
  return cost > 0 ? round2((netPrice(item, includeIva) / cost - 1) * 100) : 0;
}

// La tabla de líneas del borrador: no es un CrudColumn genérico porque cada
// fila edita 4 campos a la vez (quantity/priceType/unitPrice/discountPct) y
// muestra el aviso de stock — no encaja en "una celda, un valor de solo
// lectura".
export function OrderItemsTable({ control, errors, fields, remove }: OrderItemsTableProps) {
  const watchedItems = useWatch({ control, name: "items" }) ?? [];
  const includeIva = useWatch({ control, name: "pricesIncludeIva" }) ?? false;
  const { setValue } = useFormContext<DispatchOrderFormValues>();
  // El array de filas puede actualizarse antes que useWatch al agregar o quitar.
  // Cada variante aparece una sola vez: conservar su identidad evita cruzar
  // costos y porcentajes cuando cambia el índice de una fila.
  const watchedByVariant = new Map(watchedItems.map(item => [item.variantId, item]));
  const items = fields.map(field => watchedByVariant.get(field.variantId) ?? field);
  const costBased = items.some(item => item.costBased);

  // Mismo chequeo defensivo que AttributesFieldArray: el error de "agregá al
  // menos un ítem" (.min(1) del array completo) puede quedar en .root o
  // directo en el objeto del array según cómo lo reporte el resolver.
  const arrayLevelError =
    (errors.items as { root?: { message?: string }; message?: string } | undefined)?.root?.message ??
    (errors.items as { message?: string } | undefined)?.message;

  const total = items.reduce(
    (sum, item) => sum + unitPrice(item, includeIva) * (Number(item.quantity) || 0),
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
            <TableHead className="w-28">{includeIva ? "P. Unit. con IVA" : "P. Unit. sin IVA"}</TableHead>
            <TableHead className="w-24">{costBased ? "Incremento sobre costo (%)" : "Desc. %"}</TableHead>
            {costBased ? <><TableHead>Costo real unitario</TableHead><TableHead>Ganancia de la línea</TableHead></> : null}
            <TableHead className="w-40">Bodega y ubicación</TableHead>
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
                  <p className="whitespace-nowrap font-medium">{item?.sku}</p>
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
                        <Select value={f.value} onValueChange={f.onChange} disabled={item?.costBased}>
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
                          <Input
                            type="number" min={0} step="any" {...f}
                            value={item?.costBased ? unitPrice(item, includeIva) : f.value}
                            onChange={(e) => {
                              f.onChange(e);
                              if (!item?.costBased) return;
                              // El precio escrito manda: el incremento se deduce del costo real.
                              const typed = { ...item, unitPrice: Number(e.target.value) || 0, priceTyped: true };
                              setValue(`items.${index}.priceTyped`, true);
                              setValue(`items.${index}.markupPct`, markupFromPrice(typed, includeIva), { shouldValidate: true });
                            }}
                            aria-label={`Precio unitario ${item?.sku}`}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TableCell>
                <TableCell>
                  <FormField
                    control={control}
                    name={item?.costBased ? `items.${index}.markupPct` : `items.${index}.discountPct`}
                    render={({ field: f }) => (
                      <FormItem>
                        <FormControl>
                          <Input
                            type="number" min={0} max={item?.costBased ? 10000 : 100} step="0.01" {...f}
                            value={item?.costBased && item.priceTyped ? markupFromPrice(item, includeIva) : f.value ?? ""}
                            onChange={(e) => {
                              f.onChange(e);
                              // Escribir el incremento vuelve a calcular el precio desde el costo.
                              if (item?.costBased) setValue(`items.${index}.priceTyped`, false);
                            }}
                            aria-label={`${item?.costBased ? "Incremento sobre costo" : "Descuento"} ${item?.sku}`}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TableCell>
                {costBased ? <><TableCell>${Number(item?.costAtAdd ?? 0).toFixed(2)}</TableCell><TableCell>${((netPrice(item, includeIva) - Number(item?.costAtAdd ?? 0)) * (Number(item?.quantity) || 0)).toFixed(2)}</TableCell></> : null}
                <TableCell>
                  <FormField
                    control={control}
                    name={`items.${index}.locationId`}
                    render={({ field: f }) => (
                      <FormItem>
                        <WarehouseLocationSelect value={f.value} onChange={f.onChange} label={item.sku} />
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TableCell>
                <TableCell className="text-sm">
                  ${(unitPrice(item, includeIva) * (Number(item?.quantity) || 0)).toFixed(2)}
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

      {costBased ? <p className="text-sm text-muted-foreground">Escribe el precio o el incremento: el otro se calcula solo con el costo real promedio ponderado. El costo y el porcentaje quedan registrados con la venta. Si el costo cambia antes de guardar, vuelve a agregar el producto para revisar la negociación.</p> : null}
      {includeIva ? (
        <p className="text-right text-sm"><span className="font-medium">Total con IVA: ${total.toFixed(2)}</span><span className="block text-xs text-muted-foreground">Los precios incluyen IVA: al guardar se registran sin IVA y el total cobrado queda igual (puede variar un centavo por redondeo).</span></p>
      ) : (
        <p className="text-right text-sm"><span className="font-medium">Subtotal sin IVA: ${total.toFixed(2)}</span><span className="block text-xs text-muted-foreground">El IVA de cada producto se suma al crear la orden. Si tus precios ya incluyen IVA, marca «Precios con IVA incluido».</span></p>
      )}
    </div>
  );
}
