import type { CorsOptions } from "cors";

// CORS_ORIGIN: lista separada por comas de orígenes permitidos (ej:
// "https://app.kestore.com,https://admin.kestore.com"). Si no está seteada,
// en desarrollo se cae al comportamiento abierto de siempre (origin: true,
// refleja cualquier Origin) — en producción, el servidor ni siquiera llega a
// levantar sin esta variable (ver getMissingEnvVars en server.ts), así que
// llegar acá sin ella en producción no debería pasar nunca.
export function buildCorsOptions(): CorsOptions {
  const raw = process.env.CORS_ORIGIN;
  if (!raw) {
    return { origin: true };
  }

  const allowedOrigins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return { origin: allowedOrigins };
}
