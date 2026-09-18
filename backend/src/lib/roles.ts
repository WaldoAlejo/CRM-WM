// Jerarquía de roles: OPERATOR < ADMIN < CEO. Un rol superior pasa TODO check
// que exija uno inferior (CEO hereda todo lo de ADMIN sin excepción, por ahora).
// Única fuente de verdad: requireRole, los serializers por rol y el módulo de
// Usuarios usan estas funciones en vez de comparar `=== Role.ADMIN` a mano —
// una comparación literal dejaría a CEO afuera sin que ningún test lo note.
import { Role } from "@prisma/client";

const RANK: Record<Role, number> = {
  [Role.OPERATOR]: 0,
  [Role.ADMIN]: 1,
  [Role.CEO]: 2,
};

// ¿`userRole` alcanza el nivel de `required` (o superior)?
export function roleAtLeast(userRole: Role, required: Role): boolean {
  return RANK[userRole] >= RANK[required];
}

// Acceso de administración (ADMIN o CEO): ve costos, precios y rentabilidad.
export function hasAdminAccess(role: Role): boolean {
  return roleAtLeast(role, Role.ADMIN);
}
