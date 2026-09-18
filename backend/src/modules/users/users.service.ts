import { randomBytes } from "crypto";
import { Prisma, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { hasAdminAccess } from "../../lib/roles";
import { badRequest, conflict, forbidden, notFound } from "../../utils/httpError";

// Nunca se selecciona passwordHash fuera de este módulo (ni siquiera acá,
// salvo donde hace falta comparar/escribir): defensa en profundidad, para
// que un futuro cambio en un serializer no pueda filtrarlo por accidente.
const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export async function listUsers() {
  // Sin filtrar por isActive (a diferencia de Courier/Warehouse): acá el
  // ADMIN necesita ver también a los desactivados para poder reactivarlos —
  // "activar/desactivar" es un toggle en los dos sentidos, no un borrado
  // unidireccional.
  return prisma.user.findMany({ orderBy: { name: "asc" }, select: USER_SELECT });
}

export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!user) throw notFound("Usuario no encontrado");
  return user;
}

interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  role: Role;
}

// Un CEO es el único que puede crear, tocar o resetear a otro CEO. Sin esto,
// un ADMIN podría resetearle la contraseña a un CEO y loguearse como él
// (escalada de privilegios), aunque "crear un CEO" ya estuviera bloqueado.
function assertCanManageCeo(requesterRole: Role, targetRole: Role | undefined) {
  if (targetRole === Role.CEO && requesterRole !== Role.CEO) {
    throw forbidden("Solo un CEO puede crear, modificar o resetear a otro CEO.");
  }
}

export async function createUser(data: CreateUserInput, requesterRole: Role) {
  assertCanManageCeo(requesterRole, data.role);
  const passwordHash = await bcrypt.hash(data.password, 10);
  return prisma.user.create({
    data: { email: data.email, passwordHash, name: data.name, role: data.role },
    select: USER_SELECT,
  });
}

interface UpdateUserInput {
  email?: string;
  name?: string;
  role?: Role;
  isActive?: boolean;
}

// Cuenta cuántos OTROS usuarios activos quedan con el rol indicado(s)
// (excluye al propio usuario que se está por tocar).
async function countOtherActive(roles: Role[], excludeUserId: string): Promise<number> {
  return prisma.user.count({
    where: { role: { in: roles }, isActive: true, id: { not: excludeUserId } },
  });
}

export async function updateUser(
  id: string,
  data: UpdateUserInput,
  requesterId: string | undefined,
  requesterRole: Role
) {
  const target = await getUserById(id);

  // Permisos por jerarquía: un no-CEO no puede tocar a un CEO ni asignar el
  // rol CEO (a nadie). Va ANTES del resto para que el rechazo sea siempre 403.
  assertCanManageCeo(requesterRole, target.role);
  assertCanManageCeo(requesterRole, data.role);

  // Auto-protección: ni siquiera se evalúa si el valor "cambiaría" algo —
  // alcanza con que el campo venga en el body. Así un admin no puede
  // bloquearse a sí mismo por error (desactivarse o degradarse), pero sigue
  // pudiendo corregir su propio nombre/email desde el mismo formulario.
  if (requesterId === id && (data.role !== undefined || data.isActive !== undefined)) {
    throw badRequest("No podés cambiar tu propio rol ni tu propio estado. Pedile a otro admin que lo haga.");
  }

  // Último CEO activo: no se puede desactivar ni degradar (mismo criterio que
  // el último admin de abajo, pero contando solo CEO).
  const losingCeo =
    target.role === Role.CEO &&
    target.isActive &&
    ((data.role !== undefined && data.role !== Role.CEO) || data.isActive === false);
  if (losingCeo && (await countOtherActive([Role.CEO], id)) === 0) {
    throw conflict("Es el último CEO activo del sistema: no se puede desactivar ni quitarle el rol de CEO.");
  }

  // Último usuario con acceso de administración (ADMIN o CEO — un CEO hereda
  // todo lo de ADMIN, así que promover un ADMIN a CEO NO es "perder" acceso).
  const losingAdminAccess =
    hasAdminAccess(target.role) &&
    target.isActive &&
    ((data.role !== undefined && !hasAdminAccess(data.role)) || data.isActive === false);
  if (losingAdminAccess && (await countOtherActive([Role.ADMIN, Role.CEO], id)) === 0) {
    throw conflict("Es el último admin activo del sistema: no se puede desactivar ni quitarle el rol de ADMIN.");
  }

  return prisma.user.update({ where: { id: target.id }, data, select: USER_SELECT });
}

function generateTemporaryPassword(): string {
  // 12 caracteres legibles (sin +, / ni = de base64) — de sobra para una
  // contraseña temporal de un solo uso que el admin comunica a mano.
  return randomBytes(9).toString("base64").replace(/[+/=]/g, "").slice(0, 12);
}

export async function resetPassword(id: string, requesterRole: Role) {
  const target = await getUserById(id); // valida que exista
  assertCanManageCeo(requesterRole, target.role);

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);
  await prisma.user.update({ where: { id }, data: { passwordHash } });

  // Única vez que la contraseña en texto plano existe fuera de la memoria
  // del proceso: se devuelve en la respuesta y nunca se guarda ni se loguea.
  return { temporaryPassword };
}
