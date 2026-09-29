import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ProfitabilityByCategory } from "../reports.types";

interface CategoryProfitChartProps {
  byCategory: ProfitabilityByCategory[];
}

// El único cálculo que pasa por acá es Number(c.profit) — imprescindible
// porque recharts necesita un valor numérico para posicionar la barra, NO
// una reconstrucción de "profit" a partir de revenue/cost: el valor sigue
// siendo el mismo que ya calculó el backend, solo se convierte de string a
// number para poder graficarlo.
export function CategoryProfitChart({ byCategory }: CategoryProfitChartProps) {
  if (byCategory.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin datos en este rango.</p>;
  }

  const data = byCategory.map((c) => ({ name: c.categoryName, profit: Number(c.profit) }));
  // Alto proporcional a la cantidad de categorías para que las etiquetas no
  // se encimen; los nombres largos se truncan en el eje (el tooltip muestra
  // el nombre completo).
  const height = Math.max(200, data.length * 36 + 40);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" tick={{ fontSize: 12 }} />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          interval={0}
          tick={{ fontSize: 12 }}
          tickFormatter={(name: string) => (name.length > 16 ? `${name.slice(0, 15)}…` : name)}
        />
        <Tooltip formatter={(value) => [`$${Number(value).toFixed(2)}`, "Ganancia"]} />
        <Bar dataKey="profit" fill="#2563eb" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
