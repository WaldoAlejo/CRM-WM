import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { nestedLocationsRouter } from "../locations/locations.routes";
import {
  createWarehouseController,
  deleteWarehouseController,
  getWarehouseController,
  listWarehousesController,
  updateWarehouseController,
} from "./warehouses.controller";

export const warehousesRouter = Router();

warehousesRouter.use(requireAuth);
warehousesRouter.use("/:warehouseId/locations", nestedLocationsRouter);

// Consultar bodegas/ubicaciones: cualquier usuario autenticado (lo necesita
// OPERATOR para elegir ubicación al recibir mercadería o despachar).
warehousesRouter.get("/", asyncHandler(listWarehousesController));
warehousesRouter.get("/:id", asyncHandler(getWarehouseController));

// Administrar el catálogo de bodegas: solo admin.
warehousesRouter.post("/", requireRole(Role.ADMIN), asyncHandler(createWarehouseController));
warehousesRouter.patch("/:id", requireRole(Role.ADMIN), asyncHandler(updateWarehouseController));
warehousesRouter.delete("/:id", requireRole(Role.ADMIN), asyncHandler(deleteWarehouseController));
