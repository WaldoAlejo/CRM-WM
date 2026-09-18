import { z } from "zod";

export const searchQuerySchema = z.object({
  q: z.string().min(1, "Debes indicar un término de búsqueda"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
