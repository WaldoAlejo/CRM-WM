// Adaptador HTTP genérico para el proveedor de validación de RUC.
//
// TODO cuando se elija proveedor definitivo (ApiConsult o EcuadorAPI) y se
// tenga la cuenta creada:
//   1. Poner RUC_VALIDATION_API_URL en el .env con el endpoint real.
//   2. Poner RUC_VALIDATION_API_KEY con la API key real.
//   3. Ajustar `buildRequest` (headers/query exactos que pida ese proveedor)
//      y `parseResponse` (los nombres de campo reales de su respuesta: la
//      razón social y el estado tributario casi seguro NO se llaman
//      "razonSocial"/"estado" en la respuesta real, son solo un placeholder
//      razonable para no dejar el adaptador vacío).
//
// Mientras tanto (sin RUC_VALIDATION_API_URL configurada), este adaptador
// devuelve siempre `found: false` sin intentar ninguna llamada de red, para
// que el resto del sistema funcione en desarrollo sin credenciales.
import type { RucValidationResult, RucValidationService } from "./ruc-validation.types";

const TIMEOUT_MS = 5000;

export class HttpRucValidationAdapter implements RucValidationService {
  async validate(ruc: string): Promise<RucValidationResult> {
    const apiUrl = process.env.RUC_VALIDATION_API_URL;
    const apiKey = process.env.RUC_VALIDATION_API_KEY;

    if (!apiUrl) {
      // Sin proveedor configurado todavía: no es un error, es el estado
      // esperado hasta que se elija cuenta/proveedor.
      return { found: false, raw: null };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${apiUrl}/${encodeURIComponent(ruc)}`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        signal: controller.signal,
      });

      const raw = await response.json().catch(() => null);

      if (!response.ok) {
        return { found: false, raw };
      }

      return this.parseResponse(raw);
    } catch (error) {
      // Cualquier falla (timeout, red caída, JSON inválido): nunca se
      // propaga. Se guarda el detalle en `raw` solo para poder depurar.
      return { found: false, raw: { error: String(error) } };
    } finally {
      clearTimeout(timeout);
    }
  }

  // Placeholder: ajustar a la forma real de la respuesta del proveedor elegido.
  private parseResponse(raw: any): RucValidationResult {
    if (!raw) return { found: false, raw };
    return {
      found: true,
      businessName: raw.razonSocial ?? raw.businessName,
      taxStatus: raw.estado ?? raw.taxStatus,
      raw,
    };
  }
}
