import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { AdminUser } from "./users.types";

// GET /api/users trae TODOS los usuarios (activos e inactivos, sin
// paginar) — a diferencia del resto del catálogo, acá el admin necesita ver
// también a los desactivados para poder reactivarlos.
export function useUsers() {
  return useQuery({
    queryKey: ["users", "list"],
    queryFn: () => apiFetch<AdminUser[]>("/users"),
  });
}
