import { Card, CardContent } from "@/components/ui/card";

interface LandedCostPreviewProps {
  totalCost: number;
  totalUnits: number;
  costPerCbm: number;
  originTotal: number;
  volumeCbm: number;
}

// Vista previa en vivo del prorrateo (solo ADMIN: OPERATOR ni siquiera ve los
// costos del lote). Todo es estimado — el servidor calcula y guarda el valor
// definitivo al recibir.
export function LandedCostPreview({ totalCost, totalUnits, costPerCbm, originTotal, volumeCbm }: LandedCostPreviewProps) {
  const cards = [
    { label: "Costos del lote", value: `$${totalCost.toFixed(2)}` },
    { label: "Unidades a recibir", value: String(totalUnits) },
    { label: "Costo por CBM (USD)", value: `$${costPerCbm.toFixed(2)}` },
    { label: "Total puesto en bodega", value: `$${(originTotal + costPerCbm * volumeCbm).toFixed(2)}` },
  ];

  return (
    <div className="space-y-2" data-testid="landed-cost-preview">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <p className="text-xl font-semibold">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Costo por CBM = costos del lote / CBM del contenedor. Gasto por producto = CBM de la línea × costo por CBM / cantidad. Los costos del lote no incluyen la compra de mercadería.
      </p>
    </div>
  );
}
