import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { suggestedPrices, wholesaleTotals } from "./pricingCalculator";

interface PricingCalculatorPanelProps {
  landedCost: number;
  onUsePvp?: (pvp: number, wholesalePrice: number) => void;
}
const money = (value: number) => `$${value.toFixed(2)}`;
export function PricingCalculatorPanel({ landedCost, onUsePvp }: PricingCalculatorPanelProps) {
  const [wholesaleMarkup, setWholesaleMarkup] = useState("70");
  const [retailMarkup, setRetailMarkup] = useState("30");
  const [quantity, setQuantity] = useState("1");
  const valid = [wholesaleMarkup, retailMarkup].every(
    (v) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0
  );
  const prices = suggestedPrices(landedCost, Number(wholesaleMarkup), Number(retailMarkup));
  const pricesValid = valid && Number.isFinite(prices.retailPrice) && prices.retailPrice <= 99999999.99;
  const qty = Number(quantity);
  const totals = Number.isInteger(qty) && qty > 0 ? wholesaleTotals(prices.wholesalePrice, landedCost, qty) : null;
  return <div className="grid gap-4">
    <div className="rounded-md border p-3">
      <p>Costo real unitario (USD)</p>
      <p data-testid="landed-cost" className="text-lg font-semibold">{money(landedCost)}</p>
    </div>
    <div className="space-y-2">
      <Label htmlFor="wholesale-markup">Incremento sobre costo para mayorista (%)</Label>
      <Input id="wholesale-markup" type="number" min="0" step="any"
        value={wholesaleMarkup} onChange={(e) => setWholesaleMarkup(e.target.value)} />
    </div>
    <div className="space-y-2">
      <Label htmlFor="retail-markup">Incremento sobre mayorista para PVP (%)</Label>
      <Input id="retail-markup" type="number" min="0" step="any"
        value={retailMarkup} onChange={(e) => setRetailMarkup(e.target.value)} />
    </div>
    {pricesValid ? <div className="space-y-2 rounded-md border p-3">
      <p>Precio mayorista: <strong data-testid="wholesale-unit-price">{money(prices.wholesalePrice)}</strong></p>
      <p>PVP: <strong data-testid="suggested-pvp">{money(prices.retailPrice)}</strong></p>
      <p>Ganancia por venta mayorista: <span data-testid="wholesale-unit-profit">{money(prices.wholesalePrice - landedCost)}</span></p>
      <p>Ganancia por venta directa: <span data-testid="retail-profit">{money(prices.retailPrice - landedCost)}</span></p>
      <p>Ganancia del mayorista por unidad: {money(prices.retailPrice - prices.wholesalePrice)}</p>
      <Label htmlFor="wholesale-quantity">Cantidad</Label>
      <Input id="wholesale-quantity" type="number" min="1" step="1"
        value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      {totals ? (
        <p>
          Total mayorista: <span data-testid="wholesale-total-charge">{money(totals.totalCharge)}</span>
          {" · "}Costo: <span data-testid="wholesale-total-cost">{money(totals.totalCost)}</span>
          {" · "}Ganancia: <span data-testid="wholesale-total-profit">{money(totals.totalProfit)}</span>
        </p>
      ) : <p>Ingresa una cantidad entera mayor a cero.</p>}
    </div> : <p>Ingresa porcentajes positivos o cero que produzcan precios válidos.</p>}
    {onUsePvp ? (
      <Button type="button" disabled={!pricesValid} onClick={() => onUsePvp(prices.retailPrice, prices.wholesalePrice)}>
        Usar precios mayorista y PVP
      </Button>
    ) : null}
  </div>;
}
