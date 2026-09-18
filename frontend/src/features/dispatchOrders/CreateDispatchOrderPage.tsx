import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon } from "lucide-react";
import type { Resolver } from "react-hook-form";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { applyApiErrorToForm } from "@/components/crud/applyApiErrorToForm";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { FinalCustomer } from "@/features/finalCustomers/finalCustomers.types";
import type { SearchResult } from "@/features/search/search.types";
import { ECUADOR_PROVINCES } from "@/lib/ecuadorProvinces";
import { BuyerAutocomplete } from "./components/BuyerAutocomplete";
import { OrderItemsTable } from "./components/OrderItemsTable";
import { VariantSearchAdd } from "./components/VariantSearchAdd";
import { dispatchOrderDefaultValues, dispatchOrderFormSchema } from "./dispatchOrders.schema";
import type { DispatchOrderFormValues } from "./dispatchOrders.schema";
import type { BuyerType } from "./dispatchOrders.types";
import { useDispatchOrderMutations } from "./useDispatchOrderMutations";

export function CreateDispatchOrderPage() {
  const navigate = useNavigate();
  const { createMutation } = useDispatchOrderMutations();

  const form = useForm<DispatchOrderFormValues>({
    resolver: zodResolver(dispatchOrderFormSchema) as Resolver<DispatchOrderFormValues>,
    defaultValues: dispatchOrderDefaultValues,
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const buyerType = useWatch({ control: form.control, name: "buyerType" });
  const paymentMethod = useWatch({ control: form.control, name: "paymentMethod" });
  const items = useWatch({ control: form.control, name: "items" });

  function handleBuyerTypeChange(value: BuyerType) {
    form.setValue("buyerType", value);
    form.setValue("wholesalerId", undefined);
    form.setValue("finalCustomerId", undefined);
    // El crédito es exclusivo de mayoristas (mismo rechazo que hace el
    // backend): si ya estaba en CREDITO y se cambia a cliente final, no
    // tiene sentido dejarlo seleccionado — se resetea a CONTADO.
    if (value === "CLIENTE_FINAL" && form.getValues("paymentMethod") === "CREDITO") {
      form.setValue("paymentMethod", "CONTADO");
      form.setValue("creditDays", undefined);
    }
  }

  function handleAddItem(result: SearchResult) {
    append({
      variantId: result.variantId,
      sku: result.sku,
      label: result.label,
      quantity: 1,
      priceType: "PVP",
      unitPrice: 0,
      discountPct: undefined,
      availableStockAtAdd: result.availableStock,
      locationId: undefined,
    });
  }

  function handleSubmit(values: DispatchOrderFormValues) {
    const payload = {
      buyerType: values.buyerType,
      wholesalerId: values.buyerType === "MAYORISTA" ? values.wholesalerId : undefined,
      finalCustomerId: values.buyerType === "CLIENTE_FINAL" ? values.finalCustomerId : undefined,
      shippingProvince: values.shippingProvince,
      shippingCity: values.shippingCity,
      paymentMethod: values.paymentMethod,
      creditDays: values.paymentMethod === "CREDITO" ? values.creditDays : undefined,
      notes: values.notes || undefined,
      items: values.items.map((item) => ({
        variantId: item.variantId,
        quantity: item.quantity,
        priceType: item.priceType,
        unitPrice: item.unitPrice,
        discountPct: item.discountPct,
        locationId: item.locationId || undefined,
      })),
    };

    createMutation
      .mutateAsync(payload)
      .then((created) => navigate(`/dispatch-orders/${created.id}`))
      .catch((error: unknown) => applyApiErrorToForm(error, form));
  }

  const existingVariantIds = new Set((items ?? []).map((item) => item.variantId));

  return (
    <div className="space-y-6">
      <Link
        to="/dispatch-orders"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeftIcon className="size-4" /> Órdenes de despacho
      </Link>

      <h1 className="text-2xl font-semibold">Nueva orden de despacho</h1>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
          <section className="space-y-3 rounded-md border p-4">
            <h2 className="text-lg font-semibold">Comprador</h2>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={buyerType === "MAYORISTA" ? "default" : "outline"}
                onClick={() => handleBuyerTypeChange("MAYORISTA")}
              >
                Mayorista
              </Button>
              <Button
                type="button"
                variant={buyerType === "CLIENTE_FINAL" ? "default" : "outline"}
                onClick={() => handleBuyerTypeChange("CLIENTE_FINAL")}
              >
                Cliente final
              </Button>
            </div>
            <BuyerAutocomplete
              buyerType={buyerType}
              onSelectWholesaler={(w) => {
                form.setValue("wholesalerId", w.id);
                if (form.getValues("paymentMethod") === "CREDITO" && w.defaultCreditDays) {
                  form.setValue("creditDays", w.defaultCreditDays);
                }
              }}
              onSelectFinalCustomer={(c: FinalCustomer) => form.setValue("finalCustomerId", c.id)}
              onClear={() => {
                form.setValue("wholesalerId", undefined);
                form.setValue("finalCustomerId", undefined);
              }}
            />
            {/* No es FormMessage: ese requiere estar dentro de un
                FormField/FormItem (usa useFormField internamente) y este
                error no está atado a un input renderizado por FormField —
                BuyerAutocomplete maneja su propia UI por fuera de eso. */}
            {form.formState.errors.wholesalerId ? (
              <p className="text-sm font-medium text-destructive">
                {form.formState.errors.wholesalerId.message}
              </p>
            ) : null}
            {form.formState.errors.finalCustomerId ? (
              <p className="text-sm font-medium text-destructive">
                {form.formState.errors.finalCustomerId.message}
              </p>
            ) : null}
          </section>

          <section className="grid grid-cols-2 gap-4 rounded-md border p-4">
            <h2 className="col-span-2 text-lg font-semibold">Envío</h2>
            <FormField
              control={form.control}
              name="shippingProvince"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Provincia</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Elegí una provincia" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ECUADOR_PROVINCES.map((province) => (
                        <SelectItem key={province} value={province}>
                          {province}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="shippingCity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ciudad</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Quito" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </section>

          <section className="grid grid-cols-2 gap-4 rounded-md border p-4">
            <h2 className="col-span-2 text-lg font-semibold">Pago</h2>
            <FormField
              control={form.control}
              name="paymentMethod"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Método de pago</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="CONTADO">Contado</SelectItem>
                      {/* CREDITO ni siquiera aparece como opción para
                          CLIENTE_FINAL — el backend lo rechaza con 400, así
                          que se saca de la lista en vez de solo deshabilitarlo. */}
                      {buyerType === "MAYORISTA" ? (
                        <SelectItem value="CREDITO">Crédito</SelectItem>
                      ) : null}
                      <SelectItem value="CONTRA_ENTREGA">Contra entrega</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {paymentMethod === "CREDITO" ? (
              <FormField
                control={form.control}
                name="creditDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Días de crédito</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} step={1} {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
          </section>

          <section className="space-y-3 rounded-md border p-4">
            <h2 className="text-lg font-semibold">Ítems</h2>
            <VariantSearchAdd existingVariantIds={existingVariantIds} onAdd={handleAddItem} />
            <OrderItemsTable
              control={form.control}
              errors={form.formState.errors}
              fields={fields}
              remove={remove}
            />
          </section>

          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notas</FormLabel>
                <FormControl>
                  <Textarea placeholder="Opcional" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => navigate("/dispatch-orders")}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creando..." : "Crear orden"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
