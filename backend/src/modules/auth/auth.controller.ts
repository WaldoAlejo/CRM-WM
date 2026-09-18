import { Request, Response } from "express";
import { loginSchema } from "./auth.schemas";
import { login } from "./auth.service";

export async function loginController(req: Request, res: Response) {
  const { email, password } = loginSchema.parse(req.body);
  const result = await login(email, password);
  res.json(result);
}
