import { OrderDetailItemsTable } from "./components/OrderDetailItemsTable";
import type { DispatchOrderItem } from "./dispatchOrders.types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFieldArray, useForm } from "react-hook-form";
import { Form } from "@/components/ui/form";
import { OrderItemsTable } from "./components/OrderItemsTable";
import { negotiatedPrice } from "./negotiatedPricing";
import { applyListDiscount } from "./listPricing";
import { dispatchOrderDefaultValues, dispatchOrderItemSchema, type DispatchOrderFormValues } from "./dispatchOrders.schema";
vi.mock("@/features/warehouses/useWarehouseOptions", () => ({ useWarehouseOptions: () => ({ data: [] }) }));
vi.mock("@/hooks/usePricingVisibility", () => ({ usePricingVisibility: () => true }));
const item = { variantId: "v", sku: "AIR", label: null, quantity: 2, priceType: "PVP" as const, unitPrice: 0, availableStockAtAdd: 10, costBased: true, costAtAdd: 32.75 };
function Harness({ rate }: { rate?: number }) {
  const form = useForm<DispatchOrderFormValues>({ defaultValues: { ...dispatchOrderDefaultValues, items: [{ ...item, ivaRateAtAdd: rate }] } });
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
    expect(screen.getByText("Total con IVA: $117.90")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Agregar POWER"));
    fireEvent.change(await screen.findByLabelText("Incremento sobre costo POWER"), { target: { value: "120" } });
    expect(screen.getByText("Total con IVA: $557.90")).toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle("Quitar ítem")[0]);
    expect(screen.queryByLabelText("Precio unitario AIR")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Precio unitario POWER")).toHaveValue(220);
    expect(screen.getByText("Total con IVA: $440.00")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Quitar ítem"));
    expect(screen.queryByText(/^Total con IVA:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Agregar AIR"));
    expect(await screen.findByLabelText("Incremento sobre costo AIR")).toHaveValue(null);
    fireEvent.change(screen.getByLabelText("Incremento sobre costo AIR"), { target: { value: "70" } });
    expect(screen.getByText("Total con IVA: $111.36")).toBeInTheDocument();
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
    expect(price.value).toBe("72.05");
    expect(screen.getByText("$78.60")).toBeInTheDocument();
    expect(screen.getByText("Total con IVA: $144.10")).toBeInTheDocument();
  });
  it("al escribir el precio con IVA deduce el incremento sobre el precio sin IVA", () => {
    render(<Harness rate={15} />);
    fireEvent.change(screen.getByLabelText("Precio unitario AIR"), { target: { value: "75" } });
    // 75 / 1,15 = 65,22 sin IVA → (65,22 / 32,75 − 1) = 99,15 %
    expect(screen.getByLabelText("Incremento sobre costo AIR")).toHaveValue(99.15);
    expect(screen.getByText("Total con IVA: $150.00")).toBeInTheDocument();
    // Ganancia de la línea sobre el precio sin IVA: (65,22 − 32,75) × 2
    expect(screen.getByText("$64.94")).toBeInTheDocument();
  });
});

describe("Descuento sobre el precio de lista", () => {
  const listed = { ...item, ivaRateAtAdd: 15, listWholesaleAtAdd: 73.5, listRetailAtAdd: 100 };
  function ListHarness() {
    const form = useForm<DispatchOrderFormValues>({ defaultValues: { ...dispatchOrderDefaultValues, items: [{ ...listed, ...applyListDiscount(listed, 0, true) }] } });
    const { fields, remove } = useFieldArray({ control: form.control, name: "items" });
    return <Form {...form}><OrderItemsTable control={form.control} errors={form.formState.errors} fields={fields} remove={remove} /></Form>;
  }
  it("arranca en el PVP con IVA y un descuento reescribe precio e incremento", () => {
    render(<ListHarness />);
    expect(screen.getByText("Lista: $115.00")).toBeInTheDocument();
    expect(screen.getByLabelText("Precio unitario AIR")).toHaveValue(115);
    expect(screen.getByLabelText("Descuento sobre lista AIR")).toHaveValue(0);
    fireEvent.change(screen.getByLabelText("Descuento sobre lista AIR"), { target: { value: "10" } });
    // 115 × 0,90 = 103,50 con IVA → 90 sin IVA → (90 / 32,75 − 1) = 174,81 %
    expect(screen.getByLabelText("Precio unitario AIR")).toHaveValue(103.5);
    expect(screen.getByLabelText("Incremento sobre costo AIR")).toHaveValue(174.81);
    expect(screen.getByText("Total con IVA: $207.00")).toBeInTheDocument();
    // Escribir el precio deja ver el descuento que representa.
    fireEvent.change(screen.getByLabelText("Precio unitario AIR"), { target: { value: "92" } });
    expect(screen.getByLabelText("Descuento sobre lista AIR")).toHaveValue(20);
  });
  it("sobre el mayorista usa su lista y redondea al centavo", () => {
    expect(applyListDiscount({ ...listed, priceType: "MAYORISTA" }, 0, true)?.unitPrice).toBe(84.53);
    expect(applyListDiscount({ ...listed, priceType: "MAYORISTA" }, 5, false)?.unitPrice).toBe(69.83);
    expect(applyListDiscount({ ...item, priceType: "PVP" }, 10, true)).toBeUndefined();
  });
});

it("el detalle conserva porcentaje, precio neto y ganancia", () => {
  const saved = { id: "line", variant: { sku: "AIR", label: null }, quantity: 2, priceType: "PVP", unitPrice: "72.05", markupPct: "120", discountPct: null, landedCostSnapshot: "32.75", unitCostSnapshot: "18" } as DispatchOrderItem;
  render(<OrderDetailItemsTable items={[saved]} />);
  expect(screen.getByText("120%")).toBeInTheDocument();
  expect(screen.getByText("$78.60")).toBeInTheDocument();
  expect(screen.getByText("$144.10")).toBeInTheDocument();
});
