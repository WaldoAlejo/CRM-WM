import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { CreateDispatchOrderPage } from "./CreateDispatchOrderPage";
import { dispatchOrderDefaultValues, dispatchOrderFormSchema } from "./dispatchOrders.schema";

vi.mock("@/hooks/usePricingVisibility", () => ({ usePricingVisibility: () => true }));
vi.mock("./useDispatchOrderMutations", () => ({ useDispatchOrderMutations: () => ({ createMutation: { isPending: false } }) }));
vi.mock("./components/BuyerAutocomplete", () => ({ BuyerAutocomplete: () => null }));
vi.mock("./components/VariantSearchAdd", () => ({ VariantSearchAdd: () => null }));
vi.mock("./components/OrderItemsTable", () => ({ OrderItemsTable: () => null }));

describe("Consignación en el formulario de despacho", () => {
  it("abre desde consignación y limpia la modalidad al cambiar a cliente final", () => {
    render(<MemoryRouter initialEntries={["/dispatch-orders/new?modality=consignment"]}><CreateDispatchOrderPage /></MemoryRouter>);
    expect(screen.getByLabelText("Días de crédito al liquidar")).toBeInTheDocument();
    expect(screen.getByLabelText("Revisión cada (días)")).toHaveValue(20);
    expect(screen.getByText(/La deuda se genera al liquidar/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cliente final" }));
    expect(screen.queryByLabelText("Revisión cada (días)")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Modalidad" })).toHaveTextContent("Contado");
  });

  it("exige mayorista, crédito de liquidación e intervalo válido", () => {
    const draft = {
      ...dispatchOrderDefaultValues, buyerType: "MAYORISTA", wholesalerId: "w",
      paymentMethod: "CONSIGNACION", creditDays: 30, shippingProvince: "Guayas", shippingCity: "Guayaquil",
      items: [{ variantId: "v", sku: "SKU", label: null, quantity: 2, priceType: "MAYORISTA", unitPrice: 20, availableStockAtAdd: 10 }],
    };
    expect(dispatchOrderFormSchema.safeParse(draft).success).toBe(true);
    expect(dispatchOrderFormSchema.safeParse({ ...draft, buyerType: "CLIENTE_FINAL", finalCustomerId: "c" }).success).toBe(false);
    expect(dispatchOrderFormSchema.safeParse({ ...draft, creditDays: undefined }).success).toBe(false);
    expect(dispatchOrderFormSchema.safeParse({ ...draft, reviewIntervalDays: 91 }).success).toBe(false);
  });
});
