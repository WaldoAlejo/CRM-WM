import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  createUserController,
  getUserController,
  listUsersController,
  resetPasswordController,
  updateUserController,
} from "./users.controller";

export const usersRouter = Router();

// Todo el módulo es admin-only, a diferencia del resto del catálogo (que
// suele dejar el GET abierto a cualquier autenticado): administrar cuentas
// de otros usuarios no es algo que un OPERATOR deba poder ni siquiera leer.
usersRouter.use(requireAuth, requireRole(Role.ADMIN));

usersRouter.get("/", asyncHandler(listUsersController));
usersRouter.get("/:id", asyncHandler(getUserController));
usersRouter.post("/", asyncHandler(createUserController));
usersRouter.patch("/:id", asyncHandler(updateUserController));
usersRouter.post("/:id/reset-password", asyncHandler(resetPasswordController));
