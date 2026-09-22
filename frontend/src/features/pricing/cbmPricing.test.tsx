import { createImportBatchFormSchema } from "../importBatches/importBatches.schema";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { costPerCbm, volumeCostPerUnit, landedUnitCost } from "../importBatches/landedCost";
import { suggestedPrices } from "./pricingCalculator";
import { PricingCalculatorPanel } from "./PricingCalculatorPanel";

describe("CBM → costo real → mayorista → PVP", () => {
  it("reproduce el ejemplo sin redondear la tarifa ni el reparto intermedio", () => {
    const rate = costPerCbm(45000, 70);
    expect(rate).toBeCloseTo(642.857142857);
    expect(rate * 4.68).toBeCloseTo(3008.57142857);
    const landed = landedUnitCost(18, volumeCostPerUnit(rate, 4.68, 204));
    expect(landed).toBe(32.75);
    expect(suggestedPrices(landed)).toEqual({ wholesalePrice: 55.68, retailPrice: 72.38 });
    expect(volumeCostPerUnit(rate, 2.34, 102)).toBe(volumeCostPerUnit(rate, 4.68, 204));
  });
  it("transfiere ambos precios y rechaza porcentajes inválidos", () => {
    const onUsePvp = vi.fn();
    render(<PricingCalculatorPanel landedCost={32.75} onUsePvp={onUsePvp} />);
    expect(screen.getByTestId("wholesale-unit-price")).toHaveTextContent("$55.68");
    expect(screen.getByTestId("suggested-pvp")).toHaveTextContent("$72.38");
    fireEvent.click(screen.getByRole("button", { name: /usar precios/i }));
    expect(onUsePvp).toHaveBeenCalledWith(72.38, 55.68);
    fireEvent.change(screen.getByLabelText(/incremento sobre costo/i), { target: { value: "-1" } });
    expect(screen.getByRole("button", { name: /usar precios/i })).toBeDisabled();
  });
});

describe("Formulario de importación", () => {
  const data = { reference: "CONT", arrivalDate: "2026-09-22", containerType: "40", containerCbm: 70,
    lines: [{ variantId: "v1", sku: "AIR", label: null, productName: "Freidora", quantity: 204, unitCost: 18, volumeCbm: 4.68 }] };
  it.each(["20", "40", "40HC"])("permite volumen indicado para contenedor %s", (containerType) => {
    expect(createImportBatchFormSchema.safeParse({ ...data, containerType }).success).toBe(true);
  });
  it("exige volumen y rechaza una carga que supera el contenedor", () => {
    expect(createImportBatchFormSchema.safeParse({ ...data, containerCbm: 0 }).success).toBe(false);
    expect(createImportBatchFormSchema.safeParse({ ...data, containerCbm: 4 }).success).toBe(false);
    expect(createImportBatchFormSchema.safeParse({ ...data, lines: [{ ...data.lines[0], volumeCbm: 0 }] }).success).toBe(false);
  });
});
