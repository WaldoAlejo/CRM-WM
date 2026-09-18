-- CreateTable
CREATE TABLE "OrderNumberCounter" (
    "id" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderNumberCounter_pkey" PRIMARY KEY ("id")
);

-- Semilla del contador: calculado a partir de las órdenes que YA existen en
-- este schema, nunca hardcodeado. Esta misma migración se aplica tanto a
-- dev (90 órdenes reales verificadas al momento de escribir esto) como al
-- schema test_integration (0 órdenes) y a cualquier entorno futuro — cada
-- uno arranca su contador en el valor que le corresponde.
INSERT INTO "OrderNumberCounter" ("id", "lastNumber")
VALUES (1, (SELECT COUNT(*) FROM "DispatchOrder"));
