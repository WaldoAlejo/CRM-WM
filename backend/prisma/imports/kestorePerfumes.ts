// ============================================================================
// Importa al CRM los perfumes WM que ya se venden en Kestore (ver
// data/kestore-perfumes-wm-2026-10-23.json, exportado del Excel de carga de
// Kestore). Cada perfume queda como un producto con una sola variante, con el
// código de Kestore en `kestoreCode`, stock 0 y publicado solo en Kestore.
//
// - El precio para Kestore se guarda como precio mayorista (Kestore revende).
//   En el Excel viene CON IVA; el CRM guarda precios sin IVA, así que se divide
//   por (1 + tarifa) y se redondea al centavo (puede diferir ±0,01 al sumarle el IVA).
// - Las fotos quedan con su URL de Kestore; no se copian al disco del CRM.
// - Es idempotente: un perfume cuyo `kestoreCode` ya existe se omite.
//
// Por defecto solo muestra lo que haría. Para escribir:
//   npx ts-node prisma/imports/kestorePerfumes.ts --apply
// ============================================================================

import fs from "fs";
import path from "path";
import { Prisma, PrismaClient } from "@prisma/client";
import { DEFAULT_IVA_CODE, IVA_RATES } from "../../src/lib/ivaRates";
import { buildLabel, generateProductSku, generateUniqueVariantSku } from "../../src/lib/sku";

interface KestorePerfume {
  kestoreCode: string;
  name: string;
  brand: string;
  subcategory: string;
  description: string | null;
  kestorePrice: number;
  heightCm: number;
  widthCm: number;
  depthCm: number;
  weightKg: number;
  images: string[];
  taxed: boolean;
}

const CATEGORY = { name: "Perfumes", code: "PER" };
const DATA_FILE = path.join(__dirname, "data", "kestore-perfumes-wm-2026-10-23.json");

const prisma = new PrismaClient();

// "Armaf Club de Nuit 200 mL EDP Women" -> "200 mL". Sin tamaño en el nombre: "Única".
function sizeFromName(name: string): string {
  const match = name.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);
  return match ? `${match[1]} mL` : "Única";
}

function withoutIva(priceWithIva: number) {
  const factor = new Prisma.Decimal(IVA_RATES[DEFAULT_IVA_CODE]).div(100).plus(1);
  return new Prisma.Decimal(priceWithIva).div(factor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

async function findOrCreateCategory(apply: boolean) {
  const existing = await prisma.category.findFirst({
    where: { deletedAt: null, OR: [{ name: { equals: CATEGORY.name, mode: "insensitive" } }, { code: CATEGORY.code }] },
  });
  if (existing) {
    if (existing.code !== CATEGORY.code || existing.name.toLowerCase() !== CATEGORY.name.toLowerCase()) {
      throw new Error(`Ya existe la categoría "${existing.name}" (${existing.code}); revisar antes de importar.`);
    }
    return existing;
  }
  console.log(`+ categoría ${CATEGORY.name} (${CATEGORY.code})`);
  return apply ? prisma.category.create({ data: CATEGORY }) : null;
}

async function findOrCreateSubcategory(categoryId: string | undefined, name: string, apply: boolean) {
  if (categoryId) {
    const existing = await prisma.subcategory.findFirst({ where: { categoryId, name, deletedAt: null } });
    if (existing) return existing;
  }
  console.log(`+ subcategoría ${CATEGORY.name} / ${name}`);
  return apply && categoryId ? prisma.subcategory.create({ data: { categoryId, name } }) : null;
}

async function findOrCreateBrand(name: string, apply: boolean) {
  const existing = await prisma.brand.findFirst({ where: { deletedAt: null, name: { equals: name, mode: "insensitive" } } });
  if (existing) return existing;
  console.log(`+ marca ${name}`);
  return apply ? prisma.brand.create({ data: { name } }) : null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { products } = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as { products: KestorePerfume[] };
  console.log(`${products.length} perfumes en ${path.basename(DATA_FILE)} — ${apply ? "APLICANDO" : "simulación (usa --apply para escribir)"}`);

  const category = await findOrCreateCategory(apply);
  const subcategories = new Map<string, { id: string } | null>();
  for (const name of new Set(products.map((p) => p.subcategory))) {
    subcategories.set(name, await findOrCreateSubcategory(category?.id, name, apply));
  }
  const brands = new Map<string, { id: string } | null>();
  for (const name of new Set(products.map((p) => p.brand))) {
    brands.set(name, await findOrCreateBrand(name, apply));
  }

  const ivaCode = DEFAULT_IVA_CODE;
  let created = 0;
  let skipped = 0;
  for (const perfume of products) {
    const existing = await prisma.productVariant.findUnique({ where: { kestoreCode: perfume.kestoreCode }, select: { sku: true } });
    if (existing) {
      console.log(`= ${perfume.kestoreCode} ya existe (${existing.sku}), se omite`);
      skipped++;
      continue;
    }
    if (!perfume.taxed) throw new Error(`${perfume.kestoreCode} no lleva IVA: definir la tarifa antes de importar.`);

    const attributes = { Tamaño: sizeFromName(perfume.name) };
    console.log(`+ ${perfume.kestoreCode} ${perfume.name} [${perfume.brand} / ${perfume.subcategory}] $${perfume.kestorePrice} con IVA = $${withoutIva(perfume.kestorePrice)} sin IVA, ${attributes.Tamaño}, ${perfume.images.length} foto(s)`);
    created++;
    if (!apply || !category) continue;

    await prisma.$transaction(async (tx) => {
      const sku = await generateProductSku(tx, category.id);
      const variantSku = await generateUniqueVariantSku(sku, attributes);
      await tx.product.create({
        data: {
          sku,
          name: perfume.name,
          description: perfume.description,
          categoryId: category.id,
          subcategoryId: subcategories.get(perfume.subcategory)!.id,
          brandId: brands.get(perfume.brand)!.id,
          ivaCode,
          ivaRate: IVA_RATES[ivaCode],
          showOnWm: false,
          showOnKestore: true,
          images: { create: perfume.images.map((url, position) => ({ url, position })) },
          variants: {
            create: {
              sku: variantSku,
              kestoreCode: perfume.kestoreCode,
              attributes,
              label: buildLabel(attributes),
              weightKg: new Prisma.Decimal(perfume.weightKg),
              // largo x ancho x alto (cm), igual que el resto del catálogo.
              dimensionsCm: `${perfume.widthCm}x${perfume.depthCm}x${perfume.heightCm}`,
              wholesalePrice: withoutIva(perfume.kestorePrice),
            },
          },
        },
      });
    });
  }

  console.log(`${apply ? "Creados" : "Se crearían"}: ${created}. Omitidos (ya existían): ${skipped}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
