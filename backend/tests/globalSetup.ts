// Corre UNA sola vez, antes de toda la suite (no por cada archivo de test).
//
// Dos modos, elegidos por NEON_EPHEMERAL_TEST_BRANCH (nunca por defecto):
// - Modo normal (default, uso local día a día): usa la branch FIJA de
//   .env.test. Cero llamadas a la API de Neon, cero latencia extra, cero
//   riesgo de dejar recursos huérfanos.
// - Modo efímero (NEON_EPHEMERAL_TEST_BRANCH=true, pensado para CI): crea una
//   branch nueva de Neon para esta corrida, migra sobre ella, la pasa a los
//   tests vía `project.provide(...)`, y la borra en el teardown. Aislamiento
//   total entre corridas, a cambio de ~10-20s extra por corrida.
import { execSync } from "child_process";
import * as dotenv from "dotenv";
import path from "path";
import type { TestProject } from "vitest/node";
import { PrismaClient } from "@prisma/client";
import { truncateAllTables } from "./dbReset";
import { createEphemeralBranch, deleteEphemeralBranch, waitUntilReady } from "./neonEphemeralBranch";

declare module "vitest" {
  export interface ProvidedContext {
    neonDatabaseUrl?: string;
    neonDirectUrl?: string;
  }
}

export default async function globalSetup(project: TestProject) {
  dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

  const useEphemeral = process.env.NEON_EPHEMERAL_TEST_BRANCH === "true";

  let databaseUrl = process.env.DATABASE_URL_TEST;
  let directUrl = process.env.DIRECT_URL_TEST;
  let ephemeral: Awaited<ReturnType<typeof createEphemeralBranch>> | undefined;

  if (useEphemeral) {
    console.log("[tests] NEON_EPHEMERAL_TEST_BRANCH=true: creando branch efímera de Neon...");
    ephemeral = await createEphemeralBranch();
    databaseUrl = ephemeral.databaseUrl;
    directUrl = ephemeral.directUrl;
    console.log(`[tests] Branch creada: ${ephemeral.branchName} (${ephemeral.branchId}). Esperando a que responda...`);
    await waitUntilReady(directUrl);
    console.log("[tests] Branch efímera lista.");

    // Los tests corren en otro proceso/worker: no ven las variables que esta
    // función cambia en su propio process.env. `provide` es el mecanismo de
    // Vitest para pasarles datos serializables desde acá.
    project.provide("neonDatabaseUrl", databaseUrl);
    project.provide("neonDirectUrl", directUrl);
  }

  if (!databaseUrl || !directUrl) {
    throw new Error(
      "Faltan DATABASE_URL_TEST/DIRECT_URL_TEST. Copia .env.test.example a .env.test y complétalo."
    );
  }

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: directUrl },
  });

  if (useEphemeral) {
    // La branch efímera se forkeó de "test-fixed", que también se usa para
    // `npm test` local — puede tener filas sueltas de una corrida manual que
    // se cortó a mitad. `migrate deploy` no las borra (solo aplica schema,
    // no toca datos), así que se trunca todo explícitamente acá para que la
    // branch efímera arranque en un estado 100% determinístico (vacío) sin
    // importar en qué haya quedado test-fixed.
    console.log("[tests] Limpiando datos heredados de test-fixed en la branch efímera...");
    const ephemeralPrisma = new PrismaClient({ datasources: { db: { url: directUrl } } });
    await truncateAllTables(ephemeralPrisma, process.env.TEST_SCHEMA_NAME);
    await ephemeralPrisma.$disconnect();
    console.log("[tests] Branch efímera en estado limpio.");
  }

  return async () => {
    if (ephemeral) {
      console.log(`[tests] Borrando branch efímera ${ephemeral.branchName}...`);
      await deleteEphemeralBranch(ephemeral.branchId, ephemeral.branchName);
      console.log("[tests] Branch efímera borrada.");
    }
  };
}
