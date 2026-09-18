// Express no reenvía automáticamente los errores de funciones async a
// next(). Este wrapper evita tener que escribir try/catch en cada controlador.
import { NextFunction, Request, Response } from "express";

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

export const asyncHandler =
  (handler: AsyncRouteHandler) => (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
