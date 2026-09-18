// Restringe la escritura de ciertos campos del body a un rol específico.
// A diferencia de requireRole (que bloquea el endpoint entero), esto permite
// que el mismo endpoint sirva a distintos roles, pero rechaza EXPLÍCITAMENTE
// si el body trae un campo que ese rol no puede tocar — nunca se ignora en
// silencio, porque eso escondería al usuario por qué su cambio no se aplicó.
import { Role } from "@prisma/client";
import { NextFunction, Request, Response } from "express";
import { forbidden } from "../utils/httpError";

export function forbidFieldsForRole(fields: readonly string[], restrictedRole: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.user?.role === restrictedRole) {
      const found = fields.filter((field) => field in req.body);
      if (found.length > 0) {
        return next(forbidden("No tienes permiso para modificar precios o costos"));
      }
    }
    next();
  };
}
