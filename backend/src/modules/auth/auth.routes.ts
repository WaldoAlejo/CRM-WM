import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  changePasswordController,
  describePasswordTokenController,
  forgotPasswordController,
  loginController,
  resetPasswordController,
} from "./auth.controller";

export const authRouter = Router();

authRouter.post("/login", asyncHandler(loginController));
// Recuperación por correo (públicas). El token va en el body, no en la URL de la API,
// para que no quede en registros de acceso.
authRouter.post("/forgot-password", asyncHandler(forgotPasswordController));
authRouter.post("/password-token", asyncHandler(describePasswordTokenController));
authRouter.post("/reset-password", asyncHandler(resetPasswordController));
authRouter.post("/change-password", requireAuth, asyncHandler(changePasswordController));
