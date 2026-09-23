import { z } from 'zod';
import { validateSpatialLayout } from './warehouseSpatialCore';

const coordinate = z.number().finite().min(0).max(200);
const dimension = z.number().finite().positive().max(200);
const base = {
  id: z.string().min(1).max(80), name: z.string().trim().min(1).max(80),
  x: coordinate, y: coordinate, width: dimension, depth: dimension, rotation: z.number().finite().min(-360).max(360),
};
const storage = z.object({ ...base, type: z.literal('STORAGE'),
  code: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Usa letras, números, guion o guion bajo para el código.'),
  mode: z.enum(['FLOOR', 'STACK', 'RACK']),
  palletWidthM: z.number().finite().min(0.2).max(10), palletDepthM: z.number().finite().min(0.2).max(10),
  gapM: z.number().finite().min(0).max(2), levels: z.number().int().min(1).max(50),
  levelHeightM: z.number().finite().positive().max(20),
  slots: z.array(z.object({ row: z.number().int().min(0).max(19), column: z.number().int().min(0).max(19) })).min(1).max(400),
  intendedUse: z.string().trim().max(200).optional(),
});
export const spatialLayoutSchema = z.object({
  version: z.literal(2), heightM: z.number().finite().positive().max(100),
  boundary: z.array(z.object({ x: coordinate, y: coordinate })).min(3).max(64),
  elements: z.array(z.union([storage, z.object({ ...base, type: z.enum(['WALL', 'DOOR', 'WINDOW', 'DESK', 'DISPATCH', 'WORK', 'COLUMN', 'AISLE', 'EXCLUDED']) })])).max(150),
}).superRefine((layout, ctx) => {
  for (const message of validateSpatialLayout(layout)) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
});
