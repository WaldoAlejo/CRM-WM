import { Input } from "@/components/ui/input";

interface ProfitabilityDateFilterProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

// Compartido entre el dashboard y el detalle — cada página lee/escribe su
// propio ?from=&to= vía useDateRangeParams, este componente solo pinta los
// 2 inputs. Cada etiqueta va agrupada con su input para que en pantallas
// angostas bajen juntos de línea.
export function ProfitabilityDateFilter({ from, to, onChange }: ProfitabilityDateFilterProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-2">
        <label htmlFor="profitability-date-from" className="w-12 text-sm text-muted-foreground sm:w-auto">
          Desde
        </label>
        <Input
          id="profitability-date-from"
          type="date"
          value={from}
          onChange={(e) => onChange(e.target.value, to)}
          className="w-40"
        />
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="profitability-date-to" className="w-12 text-sm text-muted-foreground sm:w-auto">
          Hasta
        </label>
        <Input
          id="profitability-date-to"
          type="date"
          value={to}
          onChange={(e) => onChange(from, e.target.value)}
          className="w-40"
        />
      </div>
    </div>
  );
}
