import { OrderDetailItemsTable } from "./components/OrderDetailItemsTable";
import type { DispatchOrderItem } from "./dispatchOrders.types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFieldArray, useForm } from "react-hook-form";
import { Form } from "@/components/ui/form";
import { OrderItemsTable } from "./components/OrderItemsTable";
import { negotiatedPrice } from "./negotiatedPricing";
import { dispatchOrderDefaultValues, dispatchOrderItemSchema, type DispatchOrderFormValues } from "./dispatchOrders.schema";
vi.mock("@/features/warehouses/useWarehouseOptions", () => ({ useWarehouseOptions: () => ({ data: [] }) }));
vi.mock("@/hooks/usePricingVisibility", () => ({ usePricingVisibility: () => true }));
const item = { variantId: "v", sku: "AIR", label: null, quantity: 2, priceType: "PVP" as const, unitPrice: 0, availableStockAtAdd: 10, costBased: true, costAtAdd: 32.75 };
function Harness() {
  const form = useForm<DispatchOrderFormValues>({ defaultValues: { ...dispatchOrderDefaultValues, items: [item] } });
  const { fields, remove } = useFieldArray({ control: form.control, name: "items" });
  return <Form {...form}><OrderItemsTable control={form.control} errors={form.formState.errors} fields={fields} remove={remove} /></Form>;
}
function AddingItemsHarness() {
  const form = useForm<DispatchOrderFormValues>({ defaultValues: dispatchOrderDefaultValues });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  return <Form {...form}>
    <button type="button" onClick={async () => { await Promise.resolve(); append(item); }}>Agregar AIR</button>
    <button type="button" onClick={async () => { await Promise.resolve(); append({ ...item, variantId: "v2", sku: "POWER", costAtAdd: 100 }); }}>Agregar POWER</button>
    <OrderItemsTable control={form.control} errors={form.formState.errors} fields={fields} remove={remove} />
  </Form>;
}
describe("Porcentajes negociados sobre costo", () => {
  it("permite agregar, negociar, quitar y volver a agregar productos", async () => {
    render(<AddingItemsHarness />);
    fireEvent.click(screen.getByText("Agregar AIR"));
    fireEvent.change(await screen.findByLabelText("Incremento sobre costo AIR"), { target: { value: "80" } });
    expect(screen.getByText("Total: $117.90")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Agregar POWER"));
    fireEvent.change(await screen.findByLabelText("Incremento sobre costo POWER"), { target: { value: "120" } });
    expect(screen.getByText("Total: $557.90")).toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle("Quitar ítem")[0]);
    expect(screen.queryByLabelText("Precio unitario AIR")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Precio unitario POWER")).toHaveValue(220);
    expect(screen.getByText("Total: $440.00")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Quitar ítem"));
    expect(screen.queryByText(/^Total:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Agregar AIR"));
    expect(await screen.findByLabelText("Incremento sobre costo AIR")).toHaveValue(null);
    fireEvent.change(screen.getByLabelText("Incremento sobre costo AIR"), { target: { value: "70" } });
    expect(screen.getByText("Total: $111.36")).toBeInTheDocument();
  });
  it.each([[70,55.68],[80,58.95],[90,62.23],[100,65.50],[120,72.05]])("%s%% produce %s USD", (pct, price) => expect(negotiatedPrice(32.75,pct)).toBe(price));
  it("exige negociar un porcentaje y admite incrementos mayores al 100%", () => {
    expect(dispatchOrderItemSchema.safeParse(item).success).toBe(false);
    expect(dispatchOrderItemSchema.safeParse({ ...item, markupPct: 120 }).success).toBe(true);
  });
  it("actualiza precio y ganancia al escribir el porcentaje sin editar el precio", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Incremento sobre costo AIR"), { target: { value: "120" } });
    const price = screen.getByLabelText("Precio unitario AIR") as HTMLInputElement;
    expect(price.readOnly).toBe(true);
    expect(price.value).toBe("72.05");
    expect(screen.getByText("$78.60")).toBeInTheDocument();
    expect(screen.getByText("Total: $144.10")).toBeInTheDocument();
  });
});

it("el detalle conserva porcentaje, precio neto y ganancia", () => {
  const saved = { id: "line", variant: { sku: "AIR", label: null }, quantity: 2, priceType: "PVP", unitPrice: "72.05", markupPct: "120", discountPct: null, landedCostSnapshot: "32.75", unitCostSnapshot: "18" } as DispatchOrderItem;
  render(<OrderDetailItemsTable items={[saved]} />);
  expect(screen.getByText("120%")).toBeInTheDocument();
  expect(screen.getByText("$78.60")).toBeInTheDocument();
  expect(screen.getByText("$144.10")).toBeInTheDocument();
});
