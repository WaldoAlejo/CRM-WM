import { z } from "zod";

// Los inputs controlados de React Hook Form siempre mandan "" cuando el
// usuario deja un campo opcional en blanco, nunca `undefined`. Sin este
// preprocess:
// - ".email()" sobre "" falla la validación (no es un email válido).
// - ".coerce.number()" sobre "" NO falla (Number("") === 0 en JS) — pero
//   "lo dejé en blanco" y "puse 0 a propósito" son cosas distintas, y el
//   backend tiene el mismo campo como opcional (ausente), no como 0.
// En ambos casos, tratar "" como "no lo llenó" (undefined) es lo correcto,
// y es exactamente lo que el schema Zod del backend espera para un campo
// `.optional()` (ausente, no un string/número vacío).
function blankToUndefined(value: unknown) {
  return value === "" ? undefined : value;
}

export function optionalString(schema: z.ZodString) {
  return z.preprocess(blankToUndefined, schema.optional());
}

export function optionalEmail(message = "Email inválido") {
  return optionalString(z.string().email(message));
}

export function optionalNumber(schema: z.ZodNumber) {
  return z.preprocess(blankToUndefined, z.coerce.number().pipe(schema).optional());
}
