import { z } from 'zod';
import { parseDimensions } from '../../lib/storageVolume';

export const cartonPackagingSchema = z.object({
  cartonCount: z.number().int().positive().max(1000000),
  unitsPerCarton: z.number().int().positive().max(1000000),
  maxStackCartons: z.number().int().min(1).max(1000),
  stackingConfirmed: z.boolean(),
  cartonDimensionsCm: z.string().max(50).refine(v => !!parseDimensions(v), 'Usa largo x ancho x alto del cartón en cm').nullable().optional(),
}).strict().refine(p => p.cartonCount * p.unitsPerCarton <= 2147483647, 'La cantidad total excede el límite de inventario');
