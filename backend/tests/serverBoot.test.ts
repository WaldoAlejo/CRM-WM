// Evidencia de extremo a extremo (no solo la función pura getMissingEnvVars):
// arranca server.ts DE VERDAD en un proceso hijo con variables de entorno
// faltantes, y confirma que realmente hace process.exit(1) imprimiendo un
// mensaje claro — no que "debería" hacerlo según la lógica aislada.
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(__dirname, "..");

function runServerBoot(overrides: Record<string, string | undefined>) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides };
  // Evita que `import "dotenv/config"` en server.ts recargue las variables
  // REALES desde el .env del proyecto y arruine la simulación de "falta X" —
  // dotenv/config lee DOTENV_CONFIG_PATH y falla en silencio si no existe.
  env.DOTENV_CONFIG_PATH = path.join(projectRoot, "__archivo_env_inexistente__");
  delete env.DATABASE_URL;
  delete env.JWT_SECRET;
  delete env.CORS_ORIGIN;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  return spawnSync("npx", ["ts-node", "src/server.ts"], {
    cwd: projectRoot,
    env,
    encoding: "utf-8",
    timeout: 30000,
    shell: true,
  });
}

describe("server.ts: validación de entorno al arrancar", () => {
  it("sin DATABASE_URL ni JWT_SECRET: exit(1) y lista AMBAS en el mensaje", () => {
    const result = runServerBoot({ NODE_ENV: "development" });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/DATABASE_URL/);
    expect(result.stderr).toMatch(/JWT_SECRET/);
    expect(result.stdout).not.toMatch(/escuchando/); // nunca llegó a app.listen
  }, 35000);

  it("en producción sin CORS_ORIGIN (con DATABASE_URL/JWT_SECRET presentes): exit(1) listando CORS_ORIGIN", () => {
    const result = runServerBoot({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
      JWT_SECRET: "cualquier-secreto",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/CORS_ORIGIN/);
    expect(result.stderr).not.toMatch(/DATABASE_URL/);
    expect(result.stderr).not.toMatch(/JWT_SECRET/);
  }, 35000);
});
