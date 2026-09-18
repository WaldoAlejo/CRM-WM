import { Request, Response } from "express";
import { buildChinaRequestPdf } from "./chinaRequestPdf";
import { chinaRequestPdfSchema, lowStockQuerySchema } from "./purchasing.schemas";
import { listLowStock, resolveSelection } from "./purchasing.service";

export async function listLowStockController(req: Request, res: Response) {
  const { threshold } = lowStockQuerySchema.parse(req.query);
  res.json(await listLowStock(threshold));
}

export async function chinaRequestPdfController(req: Request, res: Response) {
  const { items } = chinaRequestPdfSchema.parse(req.body);
  const lines = await resolveSelection(items);
  const pdf = await buildChinaRequestPdf(lines);

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="solicitud-proveedor-${stamp}.pdf"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(pdf);
}
