import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { chinaRequestPdfController, listLowStockController } from "./purchasing.controller";

export const purchasingRouter = Router();
purchasingRouter.use(requireAuth);

// Todo el módulo es exclusivo de CEO: requireRole(CEO) no deja pasar a ADMIN (la
// jerarquía solo hace que un rol superior herede lo inferior). La lista igual
// NO trae costos ni precios en ningún caso (ver purchasing.service.ts).
purchasingRouter.get("/china-request/low-stock", requireRole(Role.CEO), asyncHandler(listLowStockController));

// Generar/descargar el documento.
purchasingRouter.post("/china-request/pdf", requireRole(Role.CEO), asyncHandler(chinaRequestPdfController));
