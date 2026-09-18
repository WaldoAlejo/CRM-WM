import type { ApiErrorBody, ListResult, PaginationMeta } from "@/types/api";

let apiBaseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";
const TOKEN_KEY = "wm_kestore_token";

// Permite apuntar apiFetch a otro servidor en tiempo de ejecución (tests que
// levantan un servidor real de prueba, o un futuro cambio de entorno sin
// reiniciar el bundle). La app en uso normal nunca la llama: usa el valor de
// VITE_API_URL de arriba.
export function setApiBaseUrl(url: string) {
  apiBaseUrl = url;
}

// Las imágenes subidas se sirven como estáticos desde la RAÍZ del backend
// (app.ts: app.use("/uploads", express.static(...))), NO bajo /api — a
// diferencia de apiFetch, que siempre antepone apiBaseUrl (que sí incluye
// /api). `image.url` que devuelve la API es relativo (ej.
// "/uploads/products/<id>/<archivo>.jpg"); esto arma la URL completa
// quitando el sufijo /api de la base configurada.
export function getAssetUrl(relativeUrl: string): string {
  const origin = apiBaseUrl.replace(/\/api\/?$/, "");
  return `${origin}${relativeUrl}`;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  field?: string;
  details?: ApiErrorBody["details"];

  constructor(message: string, status: number, field?: string, details?: ApiErrorBody["details"]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.field = field;
    this.details = details;
  }
}

// AuthProvider se registra acá al montar: apiFetch nunca importa react-router
// ni el contexto de auth directamente (no es un componente ni un hook), así
// que la reacción a un 401 (logout + redirect) vive del lado de quien SÍ
// tiene esa responsabilidad.
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler;
}

// Lee el body de la respuesta como texto primero y solo intenta parsear JSON
// si realmente hay contenido. Sin esto, un 204 (o cualquier respuesta con
// body vacío) revienta en res.json() con un SyntaxError críptico ("Unexpected
// end of JSON input") en vez de simplemente no tener nada que devolver.
async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(`Respuesta no válida del servidor (status ${res.status})`, res.status);
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();

  // Subir un archivo (POST /products/:id/images, /variants/:id/images) manda
  // options.body como FormData: el propio browser arma el `Content-Type:
  // multipart/form-data; boundary=...` correcto cuando el body es FormData, y
  // NUNCA hay que fijarlo a mano — si forzáramos "application/json" encima
  // (como se hacía antes, para todo body no vacío), el backend no podría
  // parsear el multipart en absoluto.
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;

  const res = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    // Las respuestas de la API nunca deben quedar en el cache HTTP del
    // navegador: dos GET a la misma URL con distinto estado del backend
    // (ej. justo después de crear algo) deben pegarle a la red siempre.
    cache: "no-store",
    headers: {
      ...(options.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const body = await readBody(res);

  if (!res.ok) {
    const errorBody = (body ?? {}) as Partial<ApiErrorBody>;
    if (res.status === 401) {
      onUnauthorized?.();
    }
    throw new ApiError(errorBody.error ?? `Error ${res.status}`, res.status, errorBody.field, errorBody.details);
  }

  return body as T;
}

// No todos los listados del backend paginan igual (verificado leyendo los
// services reales, no asumido): Categorías/Mayoristas devuelven un array
// plano; Proveedores/Marcas/Couriers/Clientes devuelven { data, pagination }.
// Normalizar acá es lo que le permite a useCrudResource/CrudTablePage ser un
// solo componente para ambos casos, sin ramas por recurso.
export function normalizeListResponse<T>(raw: unknown): ListResult<T> {
  if (Array.isArray(raw)) {
    return { data: raw as T[], pagination: null };
  }
  const body = raw as { data: T[]; pagination: PaginationMeta };
  return { data: body.data, pagination: body.pagination };
}
