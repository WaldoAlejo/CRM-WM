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

// Roles elegibles para ser responsable de una bodega (Warehouse.managerId):
// ADMIN u OPERATOR, y CEO porque hereda todo lo de ADMIN. Hoy coincide con
// TODOS los roles del sistema, pero se deja explícito (no "cualquier rol")
// para no depender de que el enum nunca crezca. Única fuente de verdad,
// usada tanto al validar managerId (warehouses.service.ts) como al bloquear
// la desactivación de ese usuario (users.service.ts).
export const WAREHOUSE_MANAGER_ROLES: Role[] = [Role.ADMIN, Role.OPERATOR, Role.CEO];
