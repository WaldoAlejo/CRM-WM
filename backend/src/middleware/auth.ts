// Autenticación por JWT simple + control de acceso por rol (admin/operador).
import { Role } from "@prisma/client";
import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { roleAtLeast } from "../lib/roles";
import { forbidden, unauthorized } from "../utils/httpError";

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

// Extiende el tipo de Request de Express para poder leer req.user más adelante.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Falta configurar JWT_SECRET en el .env");
  return jwt.sign(user, secret, {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? "8h") as jwt.SignOptions["expiresIn"],
  });
}

// Exige que la petición traiga un token válido (Authorization: Bearer <token>).
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) return next(unauthorized("Falta el token de autenticación"));

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Falta configurar JWT_SECRET en el .env");

  try {
    req.user = jwt.verify(token, secret) as AuthUser;
    next();
  } catch {
    next(unauthorized("Token inválido o expirado"));
  }
}

// Exige, además de estar autenticado, que el usuario tenga alguno de los roles
// indicados O UNO SUPERIOR en la jerarquía (OPERATOR < ADMIN < CEO): un CEO
// pasa todo requireRole(Role.ADMIN); requireRole(Role.CEO) deja pasar solo CEO.
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.some((required) => roleAtLeast(req.user!.role, required))) return next(forbidden());
    next();
  };
}
