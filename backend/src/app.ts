import cors from "cors";
import express from "express";
import { buildCorsOptions } from "./lib/corsOptions";
import { prisma } from "./lib/prisma";
import { UPLOADS_ROOT } from "./lib/upload";
import { errorHandler } from "./middleware/errorHandler";
import { authRouter } from "./modules/auth/auth.routes";
import { brandsRouter } from "./modules/brands/brands.routes";
import { categoriesRouter } from "./modules/categories/categories.routes";
import { couriersRouter } from "./modules/couriers/couriers.routes";
import { accountsReceivableRouter, dispatchOrdersRouter } from "./modules/dispatchOrders/dispatchOrders.routes";
import { finalCustomersRouter } from "./modules/finalCustomers/finalCustomers.routes";
import { imagesRouter } from "./modules/images/images.routes";
import { importBatchesRouter } from "./modules/importBatches/importBatches.routes";
import { insuranceClaimsRouter } from "./modules/insuranceClaims/insuranceClaims.routes";
import { inventoryRouter } from "./modules/inventory/inventory.routes";
import { productsRouter } from "./modules/products/products.routes";
import { reportsRouter } from "./modules/reports/reports.routes";
import { searchRouter } from "./modules/search/search.routes";
import { shipmentsRouter } from "./modules/shipments/shipments.routes";
import { subcategoriesRouter } from "./modules/subcategories/subcategories.routes";
import { suppliersRouter } from "./modules/suppliers/suppliers.routes";
import { variantsRouter } from "./modules/variants/variants.routes";
import { wholesalersRouter } from "./modules/wholesalers/wholesalers.routes";

export function createApp() {
  const app = express();

  app.use(cors(buildCorsOptions()));
  app.use(express.json());

  app.get("/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", db: "connected" });
    } catch {
      res.status(503).json({ status: "error", db: "disconnected" });
    }
  });

  // Archivos subidos (imágenes de productos/variantes). Ver TODO en lib/upload.ts.
  app.use("/uploads", express.static(UPLOADS_ROOT));

  app.use("/api/auth", authRouter);
  app.use("/api/categories", categoriesRouter);
  app.use("/api/subcategories", subcategoriesRouter);
  app.use("/api/wholesalers", wholesalersRouter);
  app.use("/api/suppliers", suppliersRouter);
  app.use("/api/brands", brandsRouter);
  app.use("/api/couriers", couriersRouter);
  app.use("/api/final-customers", finalCustomersRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/variants", variantsRouter);
  app.use("/api/images", imagesRouter);
  app.use("/api/search", searchRouter);
  app.use("/api/import-batches", importBatchesRouter);
  app.use("/api/inventory", inventoryRouter);
  app.use("/api/dispatch-orders", dispatchOrdersRouter);
  app.use("/api/accounts-receivable", accountsReceivableRouter);
  app.use("/api/shipments", shipmentsRouter);
  app.use("/api/insurance-claims", insuranceClaimsRouter);
  app.use("/api/reports", reportsRouter);

  // Debe ir al final: captura los errores de todas las rutas anteriores.
  app.use(errorHandler);

  return app;
}
