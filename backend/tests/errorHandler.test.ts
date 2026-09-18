import { MovementType } from "@prisma/client";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { applyMovement } from "../src/lib/inventoryMovements";
import { asyncHandler } from "../src/middleware/asyncHandler";
import { errorHandler } from "../src/middleware/errorHandler";
import { prisma, resetDatabase } from "./helpers";

afterEach(async () => {
  await resetDatabase();
});

// App mínima, propia de este archivo: expone applyMovement() en crudo, SIN
// ninguna pre-validación de existencia — a propósito, para forzar el P2025
// real que tira Prisma cuando update() no encuentra la fila, en vez de que
// un service (receiveStock, createAdjustment) lo intercepte antes con su
// propio 404. Usa el errorHandler real de producción, no uno simulado.
function buildTestApp() {
  const app = express();
  app.use(express.json());

  app.post(
    "/test/apply-movement",
    asyncHandler(async (req, res) => {
      await prisma.$transaction((tx) =>
        applyMovement(tx, {
          variantId: req.body.variantId,
          type: MovementType.AJUSTE,
          quantity: -1,
          reason: "test",
        })
      );
      res.status(201).json({ ok: true });
    })
  );

  app.post(
    "/test/create-duplicate-category",
    asyncHandler(async (req, res) => {
      await prisma.category.create({ data: { name: req.body.name } });
      res.status(201).json({ ok: true });
    })
  );

  app.use(errorHandler);
  return app;
}

describe("errorHandler: P2025 vs P2002 (antes se confundían, ahora no)", () => {
  it("P2025 (variantId inexistente, vía applyMovement crudo) da 404, no 409", async () => {
    const app = buildTestApp();

    const res = await request(app)
      .post("/test/apply-movement")
      .send({ variantId: "id-que-no-existe-de-verdad" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Registro no encontrado" });
  });

  it("P2002 (violación de unique) sigue dando 409, sin cambios", async () => {
    const app = buildTestApp();
    await prisma.category.create({ data: { name: "Categoría Duplicada Test" } });

    const res = await request(app)
      .post("/test/create-duplicate-category")
      .send({ name: "Categoría Duplicada Test" });

    expect(res.status).toBe(409);
  });
});
