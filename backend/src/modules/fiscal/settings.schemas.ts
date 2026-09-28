import { z } from "zod";

const text = z.string().trim().min(1).max(300);
const optional = z.string().trim().max(300).optional();
export const mailSchema = z.object({
  name: text, host: z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/), port: z.number().int().min(1).max(65535),
  security: z.enum(["TLS", "STARTTLS"]), username: z.string().trim().max(300), password: z.string().max(2000).optional(),
  clearPassword: z.boolean().optional(), fromName: text, fromEmail: z.string().email().max(254),
  replyTo: z.union([z.string().email().max(254), z.literal("")]).optional(), enabled: z.boolean(),
}).strict();
export const issuerSchema = z.object({
  ruc: z.string().regex(/^\d{10}001$/, "El RUC debe tener 13 dígitos y terminar en 001"), legalName: text,
  tradeName: optional, address: text, accountingRequired: z.boolean(),
  // Ficha técnica SRI, tabla 11 y anexo 21: solo el número de resolución.
  specialTaxpayer: z.union([z.string().trim().regex(/^\d{3,13}$/, "Contribuyente especial: indica solo el número de resolución (3 a 13 dígitos)"), z.literal("")]).optional(),
  withholdingAgent: z.union([z.string().trim().regex(/^[1-9]\d{0,7}$/, "Agente de retención: indica solo el número de resolución, sin ceros a la izquierda (máximo 8 dígitos)"), z.literal("")]).optional(),
  // The official XSD 1.1.0 only accepts the RIMPE emprendedor legend, so negocio popular cannot pass validation.
  regime: z.enum(["GENERAL", "RIMPE_EMPRENDEDOR", "RIMPE_POPULAR"]).refine(r => r !== "RIMPE_POPULAR", "RIMPE negocio popular no es compatible con los esquemas XSD vigentes del SRI para factura, nota de crédito y guía."),
  environment: z.enum(["1", "2"]), mailProfileId: z.string().min(1).nullable(),
}).strict();
export const seriesSchema = z.object({
  environment: z.enum(["1", "2"]), documentType: z.enum(["01", "04", "06"]),
  establishment: z.string().regex(/^\d{3}$/).refine(v => v !== "000"),
  emissionPoint: z.string().regex(/^\d{3}$/).refine(v => v !== "000"), address: text,
  lastNumber: z.number().int().min(0).max(999999998),
}).strict();
