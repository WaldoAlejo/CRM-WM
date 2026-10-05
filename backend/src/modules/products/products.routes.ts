import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { Role } from "@prisma/client";
import { requireAuth } from "../../middleware/auth";
import { forbidFieldsForRole } from "../../middleware/fieldPermissions";
import { imagesForProductRouter } from "../images/images.routes";
import { variantsForProductRouter } from "../variants/variants.routes";
import {
  createProductController,
  deleteProductController,
  getProductController,
  listProductsController,
  updateProductController,
} from "./products.controller";

export const productsRouter = Router();

productsRouter.use(requireAuth);

// Administrar el catálogo de productos es trabajo operativo del día a día
// (llega mercadería nueva, hay que darla de alta), así que admin y operador
// pueden crear/editar/eliminar. La única restricción por rol es a nivel de
// campo (precios de variante e IVA), no de endpoint completo. Un producto
// creado por OPERATOR nace con la tarifa general de IVA.
const taxFields = forbidFieldsForRole(["ivaCode"], Role.OPERATOR);
productsRouter.get("/", asyncHandler(listProductsController));
productsRouter.get("/:id", asyncHandler(getProductController));
productsRouter.post("/", taxFields, asyncHandler(createProductController));
productsRouter.patch("/:id", taxFields, asyncHandler(updateProductController));
productsRouter.delete("/:id", asyncHandler(deleteProductController));

productsRouter.use("/:productId/variants", variantsForProductRouter);
productsRouter.use("/:productId/images", imagesForProductRouter);
