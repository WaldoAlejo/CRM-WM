import { z } from "zod";
import { CHINA_REQUEST_LOW_STOCK_THRESHOLD } from "./purchasing.service";

export const lowStockQuerySchema = z.object({
  // Umbral de "stock bajo" para reposición: fijo en 10 por defecto (NO es
  // ProductVariant.minStock, que es el punto de reorden por variante que usa
  // el Dashboard). Configurable por request, nunca por variante.
  threshold: z.coerce.number().int().min(1).max(10000).default(CHINA_REQUEST_LOW_STOCK_THRESHOLD),
});

// La selección vive en el cliente y viaja completa en este body: no se
// guarda nada, no toca stock ni reservas — es solo el insumo del documento.
export const chinaRequestPdfSchema = z.object({
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int("La cantidad debe ser un entero").positive("La cantidad debe ser mayor a 0").max(1_000_000),
      })
    )
    .min(1, "Seleccioná al menos un producto")
    .max(500),
});
