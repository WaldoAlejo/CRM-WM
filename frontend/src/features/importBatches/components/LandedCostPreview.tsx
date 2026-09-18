import { Card, CardContent } from "@/components/ui/card";

interface LandedCostPreviewProps {
  totalCost: number;
  totalUnits: number;
  prorationPerUnit: number;
  originTotal: number;
}

// Vista previa en vivo del prorrateo (solo ADMIN: OPERATOR ni siquiera ve los
// costos del lote). Todo es estimado — el servidor calcula y guarda el valor
// definitivo al recibir.
export function LandedCostPreview({ totalCost, totalUnits, prorationPerUnit, originTotal }: LandedCostPreviewProps) {
  const cards = [
    { label: "Costos del lote", value: `$${totalCost.toFixed(2)}` },
    { label: "Unidades a recibir", value: String(totalUnits) },
    { label: "Prorrateo por unidad", value: `$${prorationPerUnit.toFixed(2)}` },
    { label: "Total puesto en bodega", value: `$${(originTotal + prorationPerUnit * totalUnits).toFixed(2)}` },
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
        Flete + aranceles + otros se reparten en partes iguales por unidad entre todas las unidades de este
        ingreso (no por valor). Estimado: el valor final lo calcula el servidor al recibir.
      </p>
    </div>
  );
}
