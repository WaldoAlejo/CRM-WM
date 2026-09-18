// Chequeo de arranque: el servidor NUNCA debe quedar "escuchando" con
// configuración incompleta. Junta TODAS las variables faltantes en una sola
// pasada (no falla en la primera y calla el resto) para que quien arranca el
// servidor vea de una vez todo lo que falta, no un error a la vez por reintento.
export function getMissingEnvVars(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];

  if (!env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!env.JWT_SECRET) missing.push("JWT_SECRET");
  // CORS_ORIGIN es opcional en desarrollo (cae al modo abierto), pero
  // obligatoria en producción: ahí no hay fallback seguro.
  if (env.NODE_ENV === "production" && !env.CORS_ORIGIN) missing.push("CORS_ORIGIN");

  return missing;
}
