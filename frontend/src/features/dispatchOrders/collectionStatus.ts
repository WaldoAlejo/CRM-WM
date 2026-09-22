import type { CollectionStatus } from "./dispatchOrders.types";

// Estilos ÚNICOS del semáforo de cuentas por cobrar: los usan el listado, el
// detalle y el Dashboard, para que un mismo estado se vea igual en los tres.
// El ESTADO en sí lo decide el backend (lib/receivableStatus.ts); acá solo se pinta.
//   verde = completado · gris/azul = pendiente (> 7 días) · ámbar = por vencer (0–7 días) · rojo = vencido
export const COLLECTION_STYLES: Record<
  CollectionStatus,
  { label: string; plural: string; badge: string; row: string; tile: string; dot: string }
> = {
  COMPLETADO: {
    label: "Completado",
    plural: "Completadas",
    badge: "border-transparent bg-green-100 text-green-800",
    // Tinte + barra lateral: visible de un vistazo sin depender de leer el badge.
    row: "bg-green-50/60 shadow-[inset_4px_0_0_0_#22c55e]",
    tile: "border-green-300 bg-green-50 hover:bg-green-100",
    dot: "bg-green-500",
  },
  PENDIENTE: {
    label: "Pendiente",
    plural: "Pendientes",
    badge: "border-transparent bg-slate-100 text-slate-700",
    row: "shadow-[inset_4px_0_0_0_#94a3b8]",
    tile: "border-slate-300 bg-slate-50 hover:bg-slate-100",
    dot: "bg-slate-400",
  },
  POR_VENCER: {
    label: "Por vencer",
    plural: "Por vencer",
    badge: "border-transparent bg-amber-100 text-amber-800",
    row: "bg-amber-50 shadow-[inset_4px_0_0_0_#f59e0b]",
    tile: "border-amber-300 bg-amber-50 hover:bg-amber-100",
    dot: "bg-amber-500",
  },
  VENCIDO: {
    label: "Vencido",
    plural: "Vencidas",
    badge: "border-transparent bg-red-100 text-red-800",
    row: "bg-red-50 shadow-[inset_4px_0_0_0_#ef4444]",
    tile: "border-red-300 bg-red-50 hover:bg-red-100",
    dot: "bg-red-500",
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Texto de plazo para acompañar al color. Solo redacción: el estado ya viene
// resuelto por el backend (no se recalcula ni se contradice acá).
export function describeDeadline(status: CollectionStatus | null, dueDate: string | null, now = Date.now()): string {
  if (!status || !dueDate || status === "COMPLETADO") return "—";
  const diff = new Date(dueDate).getTime() - now;
  if (status === "VENCIDO") {
    const days = Math.max(1, Math.floor(-diff / DAY_MS));
    return days === 1 ? "Vencida hace 1 día" : `Vencida hace ${days} días`;
  }
  const days = Math.ceil(diff / DAY_MS);
  if (days <= 0) return "Vence hoy";
  return days === 1 ? "Vence mañana" : `Vence en ${days} días`;
}
