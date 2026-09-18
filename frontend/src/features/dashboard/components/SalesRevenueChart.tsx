import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SalesPeriod } from "../dashboard.types";

interface SalesRevenueChartProps {
  sales: { today: SalesPeriod; week: SalesPeriod; month: SalesPeriod };
}

// Mismo componente/librería que ya usa Reportes (CategoryProfitChart): el
// único cálculo acá es Number(revenue) para poder graficarlo, el valor sigue
// siendo el que ya calculó el backend.
export function SalesRevenueChart({ sales }: SalesRevenueChartProps) {
  const data = [
    { name: "Hoy", revenue: Number(sales.today.totalRevenue) },
    { name: "Últimos 7 días", revenue: Number(sales.week.totalRevenue) },
    { name: "Mes en curso", revenue: Number(sales.month.totalRevenue) },
  ];

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ left: 8, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip formatter={(value) => [`$${Number(value).toFixed(2)}`, "Ventas"]} />
        <Bar dataKey="revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
