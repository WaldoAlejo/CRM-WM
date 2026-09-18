import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { signToken } from "../../middleware/auth";
import { unauthorized } from "../../utils/httpError";

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) throw unauthorized("Credenciales inválidas");

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) throw unauthorized("Credenciales inválidas");

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  return {
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  };
}
