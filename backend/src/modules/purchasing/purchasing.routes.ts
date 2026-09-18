import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { chinaRequestPdfController, listLowStockController } from "./purchasing.controller";

export const purchasingRouter = Router();
purchasingRouter.use(requireAuth);

// La lista NO trae costos ni precios en ningún caso (ver purchasing.service.ts),
// así que no expone nada que Productos/Inventario no muestren ya a cualquier
// usuario autenticado: por eso queda abierta a todos los roles.
purchasingRouter.get("/china-request/low-stock", asyncHandler(listLowStockController));

// Generar/descargar el documento: solo CEO. (requireRole(CEO) no deja pasar a
// ADMIN: la jerarquía solo hace que un rol superior herede lo inferior.)
purchasingRouter.post("/china-request/pdf", requireRole(Role.CEO), asyncHandler(chinaRequestPdfController));
