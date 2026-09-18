import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface AlertCardProps {
  label: string;
  value: string | number;
  subvalue?: string;
  to?: string;
  highlight?: boolean; // resalta cuando el número importa (ej: count > 0)
}

// Tarjeta genérica de alerta: si `to` viene, toda la tarjeta es un Link —
// "cada alerta debe poder hacer clic y llevar directo al módulo
// correspondiente con el filtro ya aplicado" (la URL de destino ya trae el
// filtro, esta tarjeta no sabe nada de eso).
export function AlertCard({ label, value, subvalue, to, highlight }: AlertCardProps) {
  const card = (
    <Card
      className={cn(
        highlight && "border-destructive/50",
        to && "transition-colors hover:bg-accent hover:cursor-pointer"
      )}
    >
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={cn("text-2xl font-semibold", highlight && "text-destructive")}>{value}</p>
        {subvalue ? <p className="text-xs text-muted-foreground">{subvalue}</p> : null}
      </CardContent>
    </Card>
  );

  return to ? (
    <Link to={to} className="block">
      {card}
    </Link>
  ) : (
    card
  );
}
