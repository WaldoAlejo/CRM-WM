import { describe, expect, it } from "vitest";
import {
  impliedMarkupPct,
  retailProfit,
  suggestedRetailPrice,
  wholesaleTotals,
  wholesaleUnitPrice,
  wholesaleUnitProfit,
} from "./pricingCalculator";

describe("suggestedRetailPrice — PVP sugerido con distintos % de markup", () => {
  it("replica el ejemplo exacto: costo $19.50, markup 280% → PVP $74.10", () => {
    expect(suggestedRetailPrice(19.5, 280)).toBe(74.1);
  });

  it("markup 0% deja el PVP igual al costo aterrizado", () => {
    expect(suggestedRetailPrice(19.5, 0)).toBe(19.5);
  });

  it("markup 100% duplica el costo", () => {
    expect(suggestedRetailPrice(50, 100)).toBe(100);
  });

  it("markup con decimales y costos con decimales, redondeado a centavos", () => {
    expect(suggestedRetailPrice(12.33, 45.5)).toBe(17.94); // 12.33 * 1.455 = 17.94015
  });

  it("markup muy alto (miles por ciento) sigue siendo una multiplicación simple", () => {
    expect(suggestedRetailPrice(5, 900)).toBe(50);
  });

  it("costo aterrizado 0 → PVP sugerido 0, para cualquier markup", () => {
    expect(suggestedRetailPrice(0, 280)).toBe(0);
  });
});

describe("retailProfit — ganancia unitaria al cliente final", () => {
  it("PVP $74.10 − costo $19.50 = $54.60", () => {
    expect(retailProfit(74.1, 19.5)).toBe(54.6);
  });

  it("PVP igual al costo → ganancia 0", () => {
    expect(retailProfit(20, 20)).toBe(0);
  });

  it("PVP menor al costo → ganancia negativa (se vendería con pérdida)", () => {
    expect(retailProfit(15, 20)).toBe(-5);
  });
});

describe("margen mayorista — precio, ganancia unitaria y totales, con distintos % de descuento y cantidades", () => {
  it("replica el ejemplo exacto: PVP $74.10, descuento 30% → precio mayorista $51.87", () => {
    expect(wholesaleUnitPrice(74.1, 30)).toBe(51.87);
  });

  it("replica el ejemplo exacto de punta a punta: 200 unidades → cobro $10,374, costo $3,900, ganancia $6,474", () => {
    const price = wholesaleUnitPrice(74.1, 30);
    expect(wholesaleUnitProfit(price, 19.5)).toBe(32.37);
    expect(wholesaleTotals(price, 19.5, 200)).toEqual({ totalCharge: 10374, totalCost: 3900, totalProfit: 6474 });
  });

  it("descuento 0% (precio de lista completo)", () => {
    expect(wholesaleUnitPrice(74.1, 0)).toBe(74.1);
    expect(wholesaleTotals(74.1, 19.5, 10)).toEqual({ totalCharge: 741, totalCost: 195, totalProfit: 546 });
  });

  it("descuento 100% (precio mayorista 0, siempre en pérdida por el costo)", () => {
    expect(wholesaleUnitPrice(74.1, 100)).toBe(0);
    expect(wholesaleUnitProfit(0, 19.5)).toBe(-19.5);
    expect(wholesaleTotals(0, 19.5, 5)).toEqual({ totalCharge: 0, totalCost: 97.5, totalProfit: -97.5 });
  });

  it("otro % de descuento y otra cantidad, para no depender de un único caso feliz", () => {
    const price = wholesaleUnitPrice(74.1, 15);
    expect(price).toBe(62.98);
    expect(wholesaleUnitProfit(price, 19.5)).toBe(43.48);
    expect(wholesaleTotals(price, 19.5, 37)).toEqual({ totalCharge: 2330.26, totalCost: 721.5, totalProfit: 1608.76 });
  });

  it("cantidad 1 (caso mínimo): los totales son iguales a los unitarios", () => {
    const price = wholesaleUnitPrice(74.1, 30);
    expect(wholesaleTotals(price, 19.5, 1)).toEqual({ totalCharge: 51.87, totalCost: 19.5, totalProfit: 32.37 });
  });

  it("cantidad 0: todos los totales en 0, sin dividir por cero ni romper", () => {
    expect(wholesaleTotals(51.87, 19.5, 0)).toEqual({ totalCharge: 0, totalCost: 0, totalProfit: 0 });
  });
});

describe("impliedMarkupPct — prellenar el markup a partir de un PVP ya existente", () => {
  it("es la operación inversa de suggestedRetailPrice", () => {
    const pvp = suggestedRetailPrice(19.5, 280);
    expect(impliedMarkupPct(pvp, 19.5)).toBe(280);
  });

  it("sin costo aterrizado (0 o negativo) no hay markup implícito", () => {
    expect(impliedMarkupPct(74.1, 0)).toBeNull();
    expect(impliedMarkupPct(74.1, -1)).toBeNull();
  });
});
