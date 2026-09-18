import { ProductStatus } from "@prisma/client";
import { z } from "zod";

export const createProductSchema = z.object({
  sku: z.string().min(1, "El SKU es obligatorio").max(50),
  name: z.string().min(1, "El nombre es obligatorio").max(200),
  description: z.string().max(2000).optional(),
  model: z.string().max(100).optional(),
  barcode: z.string().max(50).optional(),
  categoryId: z.string().min(1, "La categoría es obligatoria"),
  subcategoryId: z.string().min(1).optional(),
  brandId: z.string().min(1).optional(),
});

export const updateProductSchema = z.object({
  sku: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  model: z.string().max(100).nullable().optional(),
  barcode: z.string().max(50).nullable().optional(),
  status: z.nativeEnum(ProductStatus).optional(),
  categoryId: z.string().min(1).optional(),
  subcategoryId: z.string().min(1).nullable().optional(),
  brandId: z.string().min(1).nullable().optional(),
});

export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  categoryId: z.string().optional(),
  subcategoryId: z.string().optional(),
  status: z.nativeEnum(ProductStatus).optional(),
  brandId: z.string().optional(),
  q: z.string().optional(),
});
