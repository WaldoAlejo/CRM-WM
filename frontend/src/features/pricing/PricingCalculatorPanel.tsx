import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  impliedMarkupPct,
  retailProfit,
  suggestedRetailPrice,
  wholesaleTotals,
  wholesaleUnitPrice,
  wholesaleUnitProfit,
} from "./pricingCalculator";

interface PricingCalculatorPanelProps {
  landedCost: number;
  // Si el producto ya tiene PVP/% de descuento mayorista, se usan solo para
  // PRELLENAR los inputs (un punto de partida editable) — nunca se leen de
  // nuevo después del primer render.
  initialRetailPrice?: number | null;
  initialWholesaleDiscountPct?: number | null;
  // Ausente en el uso "solo mirar": el botón "Usar este PVP" no aparece.
  onUsePvp?: (pvp: number) => void;
}

const money = (value: number) => `$${value.toFixed(2)}`;

// Calculadora de precios: costo aterrizado → PVP sugerido (por % de markup) →
// margen. Es SOLO cálculo en memoria — no guarda nada, no llama a la API; el
// único efecto hacia afuera es onUsePvp, que precarga un formulario que el
// usuario todavía tiene que confirmar y guardar.
export function PricingCalculatorPanel({
  landedCost,
  initialRetailPrice,
  initialWholesaleDiscountPct,
  onUsePvp,
}: PricingCalculatorPanelProps) {
  const impliedMarkup = initialRetailPrice ? impliedMarkupPct(initialRetailPrice, landedCost) : null;
  const [markupPct, setMarkupPct] = useState(impliedMarkup !== null ? String(impliedMarkup) : "");
  const [discountPct, setDiscountPct] = useState(String(initialWholesaleDiscountPct ?? 0));
  const [quantity, setQuantity] = useState("1");

  const markupValue = Number(markupPct);
  const markupValid = markupPct.trim() !== "" && Number.isFinite(markupValue);
  const pvp = markupValid ? suggestedRetailPrice(landedCost, markupValue) : null;
  const pvpValid = pvp !== null && pvp >= 0;

  const discountValue = Number(discountPct);
  const discountValid = discountPct.trim() !== "" && Number.isFinite(discountValue) && discountValue >= 0 && discountValue <= 100;

  const qtyValue = Number(quantity);
  const qtyValid = quantity.trim() !== "" && Number.isInteger(qtyValue) && qtyValue > 0;

  // Todo lo de abajo es SOLO lectura de lo ya calculado — nunca dispara un
  // request ni escribe nada; por eso alcanza con derivarlo en cada render.
  const margin = useMemo(() => {
    if (!pvpValid) return null;
    const retail = retailProfit(pvp!, landedCost);
    if (!discountValid) return { retail, wholesale: null };
    const unitPrice = wholesaleUnitPrice(pvp!, discountValue);
    const unitProfit = wholesaleUnitProfit(unitPrice, landedCost);
    const totals = qtyValid ? wholesaleTotals(unitPrice, landedCost, qtyValue) : null;
    return { retail, wholesale: { unitPrice, unitProfit, totals } };
  }, [pvpValid, pvp, landedCost, discountValid, discountValue, qtyValid, qtyValue]);

  return (
    <div className="grid gap-4">
      <div className="rounded-md border p-3 text-sm">
        <p className="text-muted-foreground">Costo aterrizado por unidad</p>
        <p className="text-lg font-semibold" data-testid="landed-cost">
          {money(landedCost)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="markup-pct">% de markup sobre el costo</Label>
          <Input
            id="markup-pct"
            type="number"
            step="any"
            placeholder="Ej: 280"
            value={markupPct}
            onChange={(e) => setMarkupPct(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>PVP sugerido</Label>
          <p className="pt-2 text-lg font-semibold" data-testid="suggested-pvp">
            {pvpValid ? money(pvp!) : "—"}
          </p>
        </div>
      </div>

      {onUsePvp ? (
        <Button type="button" variant="outline" disabled={!pvpValid} onClick={() => onUsePvp(pvp!)}>
          Usar este PVP
        </Button>
      ) : null}

      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">Simulador de margen</p>
        {!pvpValid ? (
          <p className="text-sm text-muted-foreground">Ingresa un % de markup para ver el margen.</p>
        ) : (
          <>
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <p className="font-medium">Venta a cliente final</p>
              <p className="text-muted-foreground">
                Ganancia unitaria ={" "}
                <span className="font-medium text-foreground" data-testid="retail-profit">
                  {money(margin!.retail)}
                </span>
              </p>
            </div>

            <div className="space-y-3 rounded-md bg-muted/50 p-3 text-sm">
              <p className="font-medium">Venta a mayorista</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="wholesale-discount">% de descuento mayorista</Label>
                  <Input
                    id="wholesale-discount"
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    value={discountPct}
                    onChange={(e) => setDiscountPct(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="wholesale-quantity">Cantidad</Label>
                  <Input
                    id="wholesale-quantity"
                    type="number"
                    min={1}
                    step={1}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </div>
              </div>

              {!discountValid ? (
                <p className="text-muted-foreground">Ingresa un % de descuento entre 0 y 100.</p>
              ) : (
                <>
                  <p>
                    Precio mayorista:{" "}
                    <span className="font-medium" data-testid="wholesale-unit-price">
                      {money(margin!.wholesale!.unitPrice)}
                    </span>
                    {" · "}Ganancia unitaria:{" "}
                    <span className="font-medium" data-testid="wholesale-unit-profit">
                      {money(margin!.wholesale!.unitProfit)}
                    </span>
                  </p>
                  {!qtyValid ? (
                    <p className="text-muted-foreground">Ingresa una cantidad entera mayor a 0 para ver el total.</p>
                  ) : (
                    <p>
                      Por {qtyValue} unidades — cobro:{" "}
                      <span className="font-medium" data-testid="wholesale-total-charge">
                        {money(margin!.wholesale!.totals!.totalCharge)}
                      </span>
                      {" · "}costo:{" "}
                      <span className="font-medium" data-testid="wholesale-total-cost">
                        {money(margin!.wholesale!.totals!.totalCost)}
                      </span>
                      {" · "}ganancia:{" "}
                      <span className="font-medium" data-testid="wholesale-total-profit">
                        {money(margin!.wholesale!.totals!.totalProfit)}
                      </span>
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
