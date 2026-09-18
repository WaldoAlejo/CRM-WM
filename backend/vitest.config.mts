import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./tests/globalSetup.ts"],
    setupFiles: ["./tests/setupEnv.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    // Todos los archivos de test comparten la MISMA base de datos de test
    // (un solo schema de Postgres) y cada uno limpia las tablas en su propio
    // afterEach. Correr archivos en paralelo provocaría que un test borre
    // datos que otro archivo está usando en simultáneo — por eso se corre
    // todo en serie, no es un descuido de rendimiento.
    fileParallelism: false,
  },
});
