import { Router } from "express";
import { Role } from "@prisma/client";
import { requireAuth, requireRole } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";
import { renderDocumentPdf, OperationalDocument } from "./documentPdf";
import * as service from "./documents.service";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);
// Consignment screens and reviews are ADMIN/CEO-only in the existing process.
documentsRouter.use(["/consignments", "/reviews"], requireRole(Role.ADMIN));
const routes: [string, (id: string, paymentId: string) => Promise<OperationalDocument>][] = [
  ["/dispatch-orders/:id", service.getDispatchDocument],
  ["/dispatch-orders/:id/warehouse-out", service.getDispatchExitDocument],
  ["/dispatch-orders/:id/payments/:paymentId", service.getPaymentDocument],
  ["/dispatch-orders/:id/return", id => service.getOrderReturnDocument(id)],
  ["/dispatch-orders/:id/return-entry", id => service.getOrderReturnDocument(id, true)],
  ["/import-batches/:id", service.getImportDocument],
  ["/movements/:id", service.getMovementDocument],
  ["/consignments/:id", id => service.getConsignmentDocument(id)],
  ["/consignments/:id/warehouse-out", id => service.getConsignmentDocument(id, true)],
  ["/reviews/:id", service.getReviewDocument],
  ["/returns/:id", id => service.getReturnDocument(id)],
  ["/returns/:id/warehouse-in", id => service.getReturnDocument(id, true)],
];
for (const [path, build] of routes) {
  documentsRouter.get(path, asyncHandler(async (req, res) => {
    const document = await build(String(req.params.id), String(req.params.paymentId ?? ""));
    const buffer = await renderDocumentPdf(document);
    const filename = `documento-${document.reference.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`;
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    res.send(buffer);
  }));
}
