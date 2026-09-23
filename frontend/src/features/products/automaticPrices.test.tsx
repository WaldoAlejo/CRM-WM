import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VariantFormDialog } from "./VariantFormDialog";
import type { Variant } from "./products.types";
const { update } = vi.hoisted(() => ({ update: vi.fn().mockResolvedValue({}) }));
vi.mock("@/hooks/usePricingVisibility", () => ({ usePricingVisibility: () => true }));
vi.mock("./useVariantMutations", () => ({ useVariantMutations: () => ({ createMutation: { mutateAsync: vi.fn(), isPending: false }, updateMutation: { mutateAsync: update, isPending: false } }) }));
const variant = { id: "v1", sku: "AIR", attributes: { color: "Negro" }, weightedAverageCost: "32.75", costPriceUSD: "18", wholesalePrice: "55.68", retailPrice: "72.38", wholesaleDiscountPct: "5", retailDiscountPct: "10" } as unknown as Variant;

describe("Precios automáticos en el producto", () => {
  it("muestra precios de consulta y editar otros datos no sobrescribe los precios", async () => {
    render(<VariantFormDialog open onOpenChange={() => {}} productId="p1" productStatus="ACTIVE" variant={variant} />);
    expect(screen.queryByLabelText("Precio mayorista")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Precio público (PVP)")).not.toBeInTheDocument();
    expect(screen.getByText("$32.75")).toBeInTheDocument();
    expect(screen.queryByLabelText('Costo de fábrica (USD)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/descuento/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    const payload = update.mock.calls[0][0].values;
    expect(payload).not.toHaveProperty("wholesalePrice");
    expect(payload).not.toHaveProperty("retailPrice");
    expect(payload).not.toHaveProperty("costPriceUSD");
    expect(payload).not.toHaveProperty("wholesaleDiscountPct");
  });
  it("indica que los precios se completarán al recibir una variante nueva", () => {
    render(<VariantFormDialog open onOpenChange={() => {}} productId="p1" productStatus="ACTIVE" variant={null} />);
    expect(screen.getByText("Pendiente de recibir una importación con costo y CBM.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Precio mayorista")).not.toBeInTheDocument();
  });
});
