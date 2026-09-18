import { Role } from "@prisma/client";
import { PRICING_FIELDS } from "./pricingFields";

// Quita los campos de precio/costo del objeto ANTES de responder, si quien
// pregunta es OPERATOR. La query a Prisma que produjo `variant` siempre trae
// estos campos completos (se siguen necesitando para validaciones internas);
// este filtro es el último paso, justo antes de serializar la respuesta.
export function serializeVariantForRole<T extends Record<string, unknown>>(
  variant: T,
  role: Role
): T {
  if (role === Role.ADMIN) return variant;

  const sanitized = { ...variant }; // nunca muta el objeto original
  for (const field of PRICING_FIELDS) {
    delete (sanitized as Record<string, unknown>)[field];
  }
  return sanitized;
}
