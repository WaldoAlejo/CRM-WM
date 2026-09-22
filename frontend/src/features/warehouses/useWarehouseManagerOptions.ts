import { useUsers } from "@/features/users/useUsers";
import { WAREHOUSE_MANAGER_ROLES } from "@/lib/roles";

// Reusa useUsers() (mismo query key que la página de Usuarios: sin fetch
// duplicado si ambas están cacheadas) y filtra en el cliente — mismo criterio
// que useWholesalerOptions: dataset chico, no justifica un query param nuevo
// en el backend. El backend vuelve a validar esto igual al guardar.
export function useWarehouseManagerOptions() {
  const { data, isLoading } = useUsers();
  const options = (data ?? []).filter((u) => u.isActive && WAREHOUSE_MANAGER_ROLES.includes(u.role));
  return { data: options, isLoading };
}
