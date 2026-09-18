import { Request, Response } from "express";
import { createWholesalerSchema, updateWholesalerSchema, validateRucSchema } from "./wholesalers.schemas";
import {
  createWholesaler,
  listWholesalers,
  softDeleteWholesaler,
  updateWholesaler,
  validateRuc,
} from "./wholesalers.service";

// Llamado por el botón "Validar" del formulario: consulta el RUC y devuelve
// datos para autocompletar, pero NO crea nada todavía.
export async function validateRucController(req: Request, res: Response) {
  const { ruc } = validateRucSchema.parse(req.body);
  res.json(await validateRuc(ruc));
}

export async function listWholesalersController(_req: Request, res: Response) {
  res.json(await listWholesalers());
}

export async function createWholesalerController(req: Request, res: Response) {
  const data = createWholesalerSchema.parse(req.body);
  res.status(201).json(await createWholesaler(data));
}

export async function updateWholesalerController(req: Request, res: Response) {
  const data = updateWholesalerSchema.parse(req.body);
  res.json(await updateWholesaler(req.params.id, data));
}

export async function deleteWholesalerController(req: Request, res: Response) {
  await softDeleteWholesaler(req.params.id);
  res.status(204).send();
}
