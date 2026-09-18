import { describe, expect, it } from "vitest";
import { getMissingEnvVars } from "../src/lib/checkEnv";

describe("getMissingEnvVars", () => {
  it("sin faltantes cuando DATABASE_URL y JWT_SECRET están, en desarrollo", () => {
    const missing = getMissingEnvVars({
      DATABASE_URL: "postgres://...",
      JWT_SECRET: "secret",
      NODE_ENV: "development",
    });
    expect(missing).toEqual([]);
  });

  it("lista DATABASE_URL si falta", () => {
    const missing = getMissingEnvVars({ JWT_SECRET: "secret", NODE_ENV: "development" });
    expect(missing).toContain("DATABASE_URL");
  });

  it("lista JWT_SECRET si falta", () => {
    const missing = getMissingEnvVars({ DATABASE_URL: "postgres://...", NODE_ENV: "development" });
    expect(missing).toContain("JWT_SECRET");
  });

  it("junta TODAS las faltantes en una sola pasada, no solo la primera", () => {
    const missing = getMissingEnvVars({ NODE_ENV: "development" });
    expect(missing).toEqual(["DATABASE_URL", "JWT_SECRET"]);
  });

  it("en producción, CORS_ORIGIN también es obligatoria", () => {
    const missing = getMissingEnvVars({
      DATABASE_URL: "postgres://...",
      JWT_SECRET: "secret",
      NODE_ENV: "production",
    });
    expect(missing).toEqual(["CORS_ORIGIN"]);
  });

  it("en producción, con CORS_ORIGIN seteada, no falta nada", () => {
    const missing = getMissingEnvVars({
      DATABASE_URL: "postgres://...",
      JWT_SECRET: "secret",
      NODE_ENV: "production",
      CORS_ORIGIN: "https://app.kestore.com",
    });
    expect(missing).toEqual([]);
  });

  it("en desarrollo, CORS_ORIGIN NO es obligatoria", () => {
    const missing = getMissingEnvVars({
      DATABASE_URL: "postgres://...",
      JWT_SECRET: "secret",
      NODE_ENV: "development",
    });
    expect(missing).toEqual([]);
  });
});
