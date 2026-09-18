import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  LayoutDashboard,
  Layers,
  Package,
  ShieldAlert,
  BarChart3,
  Truck,
  Wallet,
} from "lucide-react";
import type { Role } from "@/types/auth";

export interface NavItem {
  label: string;
  path?: string;
  icon?: LucideIcon;
  // Sin `roles`: visible para cualquier usuario autenticado (ADMIN u
  // OPERATOR) — es el caso normal. Con `roles`, la sección entera se oculta
  // si el rol actual no está en la lista (mismo criterio que un router
  // ADMIN-only completo en el backend, ej. /insurance-claims, /reports).
  roles?: Role[];
  children?: NavItem[];
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard },
  { label: "Productos", path: "/products", icon: Package },
  { label: "Inventario", path: "/inventory", icon: Boxes },
  { label: "Despachos", path: "/dispatch-orders", icon: Truck },
  { label: "Cuentas por cobrar", path: "/accounts-receivable", icon: Wallet, roles: ["ADMIN"] },
  {
    label: "Catálogo",
    icon: Layers,
    children: [
      { label: "Categorías", path: "/catalog/categories" },
      { label: "Marcas", path: "/catalog/brands" },
      { label: "Proveedores", path: "/catalog/suppliers" },
      { label: "Couriers", path: "/catalog/couriers" },
      { label: "Mayoristas", path: "/catalog/wholesalers" },
      { label: "Clientes", path: "/catalog/final-customers" },
    ],
  },
  { label: "Reclamos de Seguro", path: "/insurance-claims", icon: ShieldAlert, roles: ["ADMIN"] },
  { label: "Reportes", path: "/reports", icon: BarChart3, roles: ["ADMIN"] },
];
