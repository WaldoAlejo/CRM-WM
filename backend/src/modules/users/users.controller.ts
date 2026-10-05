import { Request, Response } from "express";
import { sendAccessLink } from "../auth/passwordTokens";
import { createUserSchema, updateUserSchema } from "./users.schemas";
import { assertCanSendAccessLink, createUser, getUserById, listUsers, resetPassword, updateUser } from "./users.service";

export async function listUsersController(_req: Request, res: Response) {
  res.json(await listUsers());
}

export async function getUserController(req: Request, res: Response) {
  res.json(await getUserById(req.params.id));
}

export async function createUserController(req: Request, res: Response) {
  const data = createUserSchema.parse(req.body);
  const user = await createUser(data, req.user!.role);
  if (data.password) return res.status(201).json(user);
  // Invitación: el usuario ya existe aunque el correo falle; el admin puede
  // reenviarla desde "Acceso por correo".
  try {
    await sendAccessLink(user.id, "INVITE", req.headers.origin);
    res.status(201).json({ ...user, invitation: { sent: true } });
  } catch (error) {
    res.status(201).json({ ...user, invitation: { sent: false, error: error instanceof Error ? error.message : "No se pudo enviar" } });
  }
}

export async function sendAccessLinkController(req: Request, res: Response) {
  await assertCanSendAccessLink(req.params.id, req.user!.role);
  res.json(await sendAccessLink(req.params.id, "RESET", req.headers.origin));
}

export async function updateUserController(req: Request, res: Response) {
  const data = updateUserSchema.parse(req.body);
  res.json(await updateUser(req.params.id, data, req.user?.id, req.user!.role));
}

export async function resetPasswordController(req: Request, res: Response) {
  res.json(await resetPassword(req.params.id, req.user!.role));
}
