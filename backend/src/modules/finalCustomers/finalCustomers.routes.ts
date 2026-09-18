import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  createFinalCustomerController,
  deleteFinalCustomerController,
  getFinalCustomerController,
  listFinalCustomersController,
  updateFinalCustomerController,
} from "./finalCustomers.controller";

export const finalCustomersRouter = Router();
finalCustomersRouter.use(requireAuth);

// Consultar clientes finales: cualquier usuario autenticado.
finalCustomersRouter.get("/", asyncHandler(listFinalCustomersController));
finalCustomersRouter.get("/:id", asyncHandler(getFinalCustomerController));

// Registrar un cliente final es tarea operativa del día a día (igual que
// crear una orden): admin y operador por igual. Editar/eliminar sí queda
// admin-only.
finalCustomersRouter.post("/", asyncHandler(createFinalCustomerController));
finalCustomersRouter.patch("/:id", requireRole(Role.ADMIN), asyncHandler(updateFinalCustomerController));
finalCustomersRouter.delete("/:id", requireRole(Role.ADMIN), asyncHandler(deleteFinalCustomerController));
