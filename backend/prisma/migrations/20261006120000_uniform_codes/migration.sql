-- Códigos uniformes: prefijo de SKU por categoría, referencia de importación
-- autogenerada (IMP-) con el contenedor aparte, y códigos DEV- / REC-.

-- Categorías: prefijo de 3 letras y correlativo de SKU.
ALTER TABLE "Category" ADD COLUMN "code" TEXT;
ALTER TABLE "Category" ADD COLUMN "skuCounter" INTEGER NOT NULL DEFAULT 0;
UPDATE "Category" SET "code" = CASE "name"
  WHEN 'Hogar y Oficina' THEN 'HOG'
  WHEN 'Cocina' THEN 'COC'
  WHEN 'Energía' THEN 'ENE'
  WHEN 'Electrónica y Gadgets' THEN 'ELE'
  WHEN 'Cuidado Personal y Belleza' THEN 'CUI'
  WHEN 'Deportes y Aire Libre' THEN 'DEP'
  WHEN 'Juguetería' THEN 'JUG'
  WHEN 'Automotriz' THEN 'AUT'
END;
-- Cualquier otra categoría existente recibe un código provisional único.
UPDATE "Category" c SET "code" = 'C' || lpad(n.rn::text, 2, '0')
FROM (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "Category" WHERE "code" IS NULL) n
WHERE c."id" = n."id";
ALTER TABLE "Category" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "Category_code_key" ON "Category"("code");

-- Importaciones: el número de contenedor pasa a un campo propio.
ALTER TABLE "ImportBatch" ADD COLUMN "containerNumber" TEXT;
UPDATE "ImportBatch" SET "containerNumber" = "reference" WHERE "reference" NOT LIKE 'IMP-%';

-- Devoluciones y reclamos: código correlativo.
ALTER TABLE "ReturnBatch" ADD COLUMN "code" TEXT;
UPDATE "ReturnBatch" r SET "code" = 'DEV-' || lpad(n.rn::text, 6, '0')
FROM (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "ReturnBatch") n WHERE r."id" = n."id";
ALTER TABLE "ReturnBatch" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "ReturnBatch_code_key" ON "ReturnBatch"("code");

ALTER TABLE "InsuranceClaim" ADD COLUMN "code" TEXT;
UPDATE "InsuranceClaim" r SET "code" = 'REC-' || lpad(n.rn::text, 6, '0')
FROM (SELECT "id", row_number() OVER (ORDER BY "claimDate", "id") AS rn FROM "InsuranceClaim") n WHERE r."id" = n."id";
ALTER TABLE "InsuranceClaim" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "InsuranceClaim_code_key" ON "InsuranceClaim"("code");

-- Contadores (los existentes 1 y 2 no se tocan).
INSERT INTO "OrderNumberCounter" ("id", "lastNumber") VALUES
  (1, 0), (2, 0), (3, 0),
  (4, (SELECT count(*) FROM "ReturnBatch")),
  (5, (SELECT count(*) FROM "InsuranceClaim"))
ON CONFLICT ("id") DO NOTHING;
