// Se carga antes de evaluar cada archivo de test (así lo pide Vitest vía
// `setupFiles`). Tiene que fijar DATABASE_URL/DIRECT_URL ANTES de que el
// archivo de test importe `../src/app` (que a su vez importa
// `src/lib/prisma.ts`, donde se crea el PrismaClient leyendo esas variables):
// si el orden fuera al revés, los tests terminarían golpeando la base
// equivocada por accidente.
import * as dotenv from "dotenv";
import path from "path";
import { inject } from "vitest";

dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

const useEphemeral = process.env.NEON_EPHEMERAL_TEST_BRANCH === "true";

// Modo efímero: la branch la creó globalSetup.ts en OTRO proceso, así que la
// única forma de enterarse acá es vía `inject` (ver project.provide allá).
// Modo normal: ya está en .env.test bajo los nombres *_TEST, cargado arriba.
process.env.DATABASE_URL = useEphemeral ? inject("neonDatabaseUrl") : process.env.DATABASE_URL_TEST;
process.env.DIRECT_URL = useEphemeral ? inject("neonDirectUrl") : process.env.DIRECT_URL_TEST;
process.env.JWT_EXPIRES_IN = "1h";
