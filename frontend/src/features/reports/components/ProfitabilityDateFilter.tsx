import { Input } from "@/components/ui/input";

interface ProfitabilityDateFilterProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

// Compartido entre el dashboard y el detalle — cada página lee/escribe su
// propio ?from=&to= vía useDateRangeParams, este componente solo pinta los
// 2 inputs.
export function ProfitabilityDateFilter({ from, to, onChange }: ProfitabilityDateFilterProps) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="profitability-date-from" className="text-sm text-muted-foreground">
        Desde
      </label>
      <Input
        id="profitability-date-from"
        type="date"
        value={from}
        onChange={(e) => onChange(e.target.value, to)}
        className="w-40"
      />
      <label htmlFor="profitability-date-to" className="text-sm text-muted-foreground">
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
  );
}
