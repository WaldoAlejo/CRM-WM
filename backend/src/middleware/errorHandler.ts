// Middleware central de errores: convierte cualquier error lanzado en la app
// (validaciones, reglas de negocio, errores de Prisma) en una respuesta JSON
// consistente, en vez de repetir ese mapeo en cada controlador.
import { Prisma } from "@prisma/client";
import { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { UnsupportedFileTypeError } from "../lib/upload";
import { HttpError } from "../utils/httpError";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof HttpError) {
    // `...err.details` permite que el service adjunte datos como
    // `{ field: "sku" }` sin que este manejador necesite saber nada de
    // productos/variantes específicamente.
    return res.status(err.statusCode).json({ error: err.message, ...err.details });
  }

  if (err instanceof multer.MulterError || err instanceof UnsupportedFileTypeError) {
    return res.status(400).json({ error: err.message });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Datos inválidos",
      details: err.issues.map((issue) => ({
        campo: issue.path.join("."),
        mensaje: issue.message,
      })),
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Ya existe un registro con ese valor único." });
    }
    // P2025 = "registro no encontrado" (ej: update/delete sobre un id que no
    // existe) — es un 404, no un conflicto. Antes estaba agrupado con P2003
    // y devolvía 409 para ambos; separado ahora porque applyMovement()
    // (compartida entre Ingresos, Ajustes y el futuro módulo de Despachos)
    // depende de que un variantId inexistente dé siempre el código correcto,
    // sin que cada caller tenga que acordarse de pre-validar la existencia.
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Registro no encontrado" });
    }
    if (err.code === "P2003") {
      return res.status(409).json({ error: "Operación no permitida por relaciones existentes." });
    }
  }

  console.error(err);
  return res.status(500).json({ error: "Error interno del servidor" });
}
