import type { Role } from "@/types/auth";

// Jerarquía de roles, espejo de backend/src/lib/roles.ts: OPERATOR < ADMIN < CEO.
// Un rol superior pasa TODO check que exija uno inferior (CEO hereda todo lo
// de ADMIN). Nunca compares `role === "ADMIN"` a mano: dejaría a CEO afuera.
const RANK: Record<Role, number> = { OPERATOR: 0, ADMIN: 1, CEO: 2 };

export function roleAtLeast(role: Role | null | undefined, required: Role): boolean {
  return !!role && RANK[role] >= RANK[required];
}

// Acceso de administración (ADMIN o CEO): costos, precios, rentabilidad, catálogo.
export function hasAdminAccess(role: Role | null | undefined): boolean {
  return roleAtLeast(role, "ADMIN");
}

export function isCeo(role: Role | null | undefined): boolean {
  return role === "CEO";
}

// ¿el rol alcanza alguno de los indicados (o uno superior)? Lo usan el menú
// lateral y RequireRole: `roles: ["ADMIN"]` significa "ADMIN o superior".
export function roleSatisfies(role: Role | null | undefined, allowed: Role[]): boolean {
  return allowed.some((required) => roleAtLeast(role, required));
}

// Espejo de WAREHOUSE_MANAGER_ROLES en backend/src/lib/roles.ts: roles
// elegibles para ser responsable de una bodega. Filtra el selector del
// formulario de Bodegas — el backend vuelve a validarlo, esto es solo para
// no ofrecer opciones que el submit rechazaría.
export const WAREHOUSE_MANAGER_ROLES: Role[] = ["ADMIN", "OPERATOR", "CEO"];
