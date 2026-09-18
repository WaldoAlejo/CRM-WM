import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import type { Role } from "@/types/auth";

// Espejo de los routers ADMIN-only del backend (insurance-claims, reports):
// si el rol no alcanza, ni siquiera intenta renderizar la página — redirige
// al dashboard, igual que el backend respondería 403 antes de tocar el service.
export function RequireRole({ roles }: { roles: Role[] }) {
  const { role } = useAuth();

  if (!role || !roles.includes(role)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
