import { Request, Response } from "express";
import { createUserSchema, updateUserSchema } from "./users.schemas";
import { createUser, getUserById, listUsers, resetPassword, updateUser } from "./users.service";

export async function listUsersController(_req: Request, res: Response) {
  res.json(await listUsers());
}

export async function getUserController(req: Request, res: Response) {
  res.json(await getUserById(req.params.id));
}

export async function createUserController(req: Request, res: Response) {
  const data = createUserSchema.parse(req.body);
  res.status(201).json(await createUser(data));
}

export async function updateUserController(req: Request, res: Response) {
  const data = updateUserSchema.parse(req.body);
  res.json(await updateUser(req.params.id, data, req.user?.id));
}

export async function resetPasswordController(req: Request, res: Response) {
  res.json(await resetPassword(req.params.id));
}
