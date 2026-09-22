import "dotenv/config";
import { getMissingEnvVars } from "./lib/checkEnv";

const missing = getMissingEnvVars();
if (missing.length > 0) {
  console.error(
    `No se puede arrancar: faltan las siguientes variables de entorno:\n${missing
      .map((name) => `  - ${name}`)
      .join("\n")}`
  );
  process.exit(1);
}

// Import DIFERIDO a propósito: `./app` importa (transitivamente) a
// @prisma/client, y @prisma/client carga su PROPIO .env al inicializarse —
// independiente de nuestro `import "dotenv/config"` de arriba. Si `./app` se
// importara de forma estática antes del chequeo (como un `import` normal al
// tope del archivo), ese auto-load de Prisma repoblaría DATABASE_URL/etc.
// ANTES de que getMissingEnvVars() llegue a leerlas, dejando el chequeo
// efectivamente inútil en cualquier entorno donde exista un .env real. El
// chequeo debe correr ANTES de que cualquier módulo toque Prisma.
import("./app").then(({ createApp }) => {
  const port = Number(process.env.PORT ?? 4000);

  createApp().listen(port, () => {
    console.log(`API de inventario WM/Kestore escuchando en http://localhost:${port}`);
    // Tareas programadas (recordatorios de pago por vencer). Aquí y no en
    // createApp(): los tests nunca deben arrancar un job real.
    import("./jobs/scheduler").then(({ startScheduler }) => startScheduler());
  });
});
