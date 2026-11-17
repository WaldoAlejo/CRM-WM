import { Card, CardContent } from "@/components/ui/card";

interface LandedCostPreviewProps {
  totalCost: number;
  totalUnits: number;
  volumeRate: number;
  originTotal: number;
  expensesTotal: number;
}

// Vista previa en vivo del prorrateo (solo ADMIN: OPERATOR ni siquiera ve los
// costos del lote). Todo es estimado — el servidor calcula y guarda el valor
// definitivo al recibir.
export function LandedCostPreview({ totalCost, totalUnits, volumeRate, originTotal, expensesTotal }: LandedCostPreviewProps) {
  const cards = [
    { label: "Costos del lote", value: `$${totalCost.toFixed(2)}` },
    { label: "Unidades a recibir", value: String(totalUnits) },
    { label: "Flete y otros por CBM (USD)", value: `$${volumeRate.toFixed(2)}` },
    { label: "Total puesto en bodega", value: `$${(originTotal + expensesTotal).toFixed(2)}` },
  ];

  return (
    <div className="space-y-2" data-testid="landed-cost-preview">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <p className="break-words text-lg font-semibold sm:text-xl">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Flete y otros gastos se reparten por volumen: (flete + otros) / CBM contratados del lote (contenedor completo o carga LCL) × CBM de la línea. La aduana se reparte por valor: aduana × (cantidad × costo en origen de la línea) / valor en origen de todo lo recibido en el lote, y se recalcula en cada recepción. Gasto por unidad = gasto de la línea / cantidad. Los costos del lote no incluyen la compra de mercadería. La importación registra el costo real. El porcentaje de ganancia y el precio de venta se acuerdan con cada comprador en el despacho.
      </p>
    </div>
  );
}
