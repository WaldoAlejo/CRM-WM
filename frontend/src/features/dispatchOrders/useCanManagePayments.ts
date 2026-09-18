import { hasAdminAccess } from "@/lib/roles";
import { useAuth } from "@/context/AuthContext";

// Espejo de requireRole(Role.ADMIN) en POST /dispatch-orders/:id/payments —
// mismo idioma que usePricingVisibility: `role` de AuthContext es síncrono
// desde el primer render (ver AuthContext.tsx), así que no hay estado
// "cargando sesión" en el que esto pudiera devolver true por defecto.
export function useCanManagePayments(): boolean {
  const { role } = useAuth();
  return hasAdminAccess(role);
}
