import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  createCourierController,
  deleteCourierController,
  getCourierController,
  listCouriersController,
  updateCourierController,
} from "./couriers.controller";

export const couriersRouter = Router();
couriersRouter.use(requireAuth);

// Consultar couriers: cualquier usuario autenticado.
couriersRouter.get("/", asyncHandler(listCouriersController));
couriersRouter.get("/:id", asyncHandler(getCourierController));

// Administrar el catálogo de couriers: solo admin.
couriersRouter.post("/", requireRole(Role.ADMIN), asyncHandler(createCourierController));
couriersRouter.patch("/:id", requireRole(Role.ADMIN), asyncHandler(updateCourierController));
couriersRouter.delete("/:id", requireRole(Role.ADMIN), asyncHandler(deleteCourierController));
