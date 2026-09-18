import { randomBytes } from "crypto";
import { Prisma, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, notFound } from "../../utils/httpError";

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

export async function createUser(data: CreateUserInput) {
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

// Cuenta cuántos OTROS admin activos quedan (excluye al propio usuario que
// se está por tocar) — es el número que importa para decidir si esta edición
// dejaría al sistema sin ningún admin que pueda operarlo.
async function countOtherActiveAdmins(excludeUserId: string): Promise<number> {
  return prisma.user.count({
    where: { role: Role.ADMIN, isActive: true, id: { not: excludeUserId } },
  });
}

export async function updateUser(id: string, data: UpdateUserInput, requesterId: string | undefined) {
  const target = await getUserById(id);

  // Auto-protección: ni siquiera se evalúa si el valor "cambiaría" algo —
  // alcanza con que el campo venga en el body. Así un admin no puede
  // bloquearse a sí mismo por error (desactivarse o degradarse), pero sigue
  // pudiendo corregir su propio nombre/email desde el mismo formulario.
  if (requesterId === id && (data.role !== undefined || data.isActive !== undefined)) {
    throw badRequest("No podés cambiar tu propio rol ni tu propio estado. Pedile a otro admin que lo haga.");
  }

  const losingAdminAccess =
    target.role === Role.ADMIN &&
    target.isActive &&
    ((data.role !== undefined && data.role !== Role.ADMIN) || data.isActive === false);

  if (losingAdminAccess) {
    const otherActiveAdmins = await countOtherActiveAdmins(id);
    if (otherActiveAdmins === 0) {
      throw conflict("Es el último admin activo del sistema: no se puede desactivar ni quitarle el rol de ADMIN.");
    }
  }

  return prisma.user.update({ where: { id: target.id }, data, select: USER_SELECT });
}

function generateTemporaryPassword(): string {
  // 12 caracteres legibles (sin +, / ni = de base64) — de sobra para una
  // contraseña temporal de un solo uso que el admin comunica a mano.
  return randomBytes(9).toString("base64").replace(/[+/=]/g, "").slice(0, 12);
}

export async function resetPassword(id: string) {
  await getUserById(id); // valida que exista

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);
  await prisma.user.update({ where: { id }, data: { passwordHash } });

  // Única vez que la contraseña en texto plano existe fuera de la memoria
  // del proceso: se devuelve en la respuesta y nunca se guarda ni se loguea.
  return { temporaryPassword };
}
