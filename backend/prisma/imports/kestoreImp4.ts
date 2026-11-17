// ============================================================================
// Publica en Kestore los productos de la importación IMP-000004 (contenedor
// COSU6466309860). Hoy el CRM envía el webhook a kestore-dev, que crea los
// productos que no conoce con GET /catalog (nombre, marca, subcategoría, peso,
// fotos y descripción).
//
// Por cada variante del lote:
// - kestoreCode = SKU del CRM (si aún no tiene código).
// - Precio para Kestore (precio mayorista, SIN IVA) = costo puesto × 1,5: costo
//   en origen más gastos de importación del lote, con 50 % de margen. Kestore
//   arma su PVP encima.
// - El producto se marca "Publicar en Kestore".
//
// El ventilador (HOG-0004) no tenía marca, subcategoría, peso ni medidas, y
// Kestore no crea un producto sin eso: lleva la marca y la subcategoría de las
// sillas y un peso estimado; las medidas salen del BL (8,44 m³ / 352 u.).
//
// Es idempotente. Por defecto solo muestra lo que haría. Para escribir:
//   npx ts-node prisma/imports/kestoreImp4.ts --apply
// ============================================================================

import { MovementType, Prisma, PrismaClient } from "@prisma/client";

const BATCH_REFERENCE = "IMP-000004";
const MARGIN = new Prisma.Decimal("1.5");
const FAN_PRODUCT_SKU_PREFIX = "HOG-0004";
const CHAIR_PRODUCT_SKU_PREFIX = "HOG-0001";
const FAN_WEIGHT_KG = new Prisma.Decimal(5);
const FAN_DIMENSIONS_CM = "64X25X15";

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "APLICANDO" : "Simulación (usa --apply para escribir)");

  const batch = await prisma.importBatch.findFirstOrThrow({ where: { reference: BATCH_REFERENCE } });
  const movements = await prisma.inventoryMovement.findMany({
    where: { importBatchId: batch.id, type: MovementType.INGRESO, quantity: { gt: 0 } },
    select: { variantId: true, quantity: true, unitCost: true, landedCostPerUnit: true },
  });
  const landed = new Map<string, { units: number; total: Prisma.Decimal }>();
  for (const m of movements) {
    const unit = new Prisma.Decimal(m.unitCost ?? 0).plus(m.landedCostPerUnit ?? 0);
    const acc = landed.get(m.variantId) ?? { units: 0, total: new Prisma.Decimal(0) };
    landed.set(m.variantId, { units: acc.units + m.quantity, total: acc.total.plus(unit.times(m.quantity)) });
  }

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: [...landed.keys()] }, deletedAt: null },
    include: { product: true },
    orderBy: { sku: "asc" },
  });
  const chair = variants.find((v) => v.sku.startsWith(CHAIR_PRODUCT_SKU_PREFIX))?.product;

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  const products = new Set<string>();
  for (const v of variants) {
    const { units, total } = landed.get(v.id)!;
    const cost = total.dividedBy(units);
    const price = cost.times(MARGIN).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const code = v.kestoreCode ?? v.sku;
    const data: Prisma.ProductVariantUpdateInput = {};
    if (!v.kestoreCode) data.kestoreCode = code;
    if (!v.wholesalePrice || !v.wholesalePrice.equals(price)) data.wholesalePrice = price;

    const fan = v.sku.startsWith(FAN_PRODUCT_SKU_PREFIX);
    if (fan && !v.weightKg) data.weightKg = FAN_WEIGHT_KG;
    if (fan && !v.dimensionsCm) data.dimensionsCm = FAN_DIMENSIONS_CM;

    console.log(`${code.padEnd(42)} costo puesto $${cost.toFixed(2).padStart(7)} -> Kestore $${price.toFixed(2).padStart(7)} sin IVA, stock ${v.stock - v.reservedStock}`
      + (Object.keys(data).length ? `  [${Object.keys(data).join(", ")}]` : "  [sin cambios]"));
    if (Object.keys(data).length) ops.push(prisma.productVariant.update({ where: { id: v.id }, data }));

    if (products.has(v.productId)) continue;
    products.add(v.productId);
    const productData: Prisma.ProductUncheckedUpdateInput = {};
    if (!v.product.showOnKestore) productData.showOnKestore = true;
    if (fan && !v.product.brandId) productData.brandId = chair?.brandId;
    if (fan && !v.product.subcategoryId) productData.subcategoryId = chair?.subcategoryId;
    if (Object.keys(productData).length) {
      console.log(`  producto "${v.product.name.trim()}": ${Object.keys(productData).join(", ")}`);
      ops.push(prisma.product.update({ where: { id: v.productId }, data: productData }));
    }
  }

  if (!chair?.brandId || !chair.subcategoryId) throw new Error("No se encontró la marca o subcategoría de las sillas para el ventilador.");
  console.log(`${variants.length} variantes, ${ops.length} cambios.`);
  if (apply && ops.length) {
    await prisma.$transaction(ops);
    console.log("Listo. El CRM envía el webhook a Kestore en los próximos segundos.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
