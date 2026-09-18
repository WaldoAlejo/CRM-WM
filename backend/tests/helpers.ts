import { randomUUID } from "crypto";
import { PrismaClient, ProductStatus, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { signToken } from "../src/middleware/auth";
import { truncateAllTables } from "./dbReset";

// Cliente propio para los tests (no el singleton de src/lib/prisma), y a
// propósito conectado con DIRECT_URL_TEST (sin pooler), no con la pooled.
//
// INCIDENTE REAL que motiva esto: la primera versión de este helper usaba
// `current_schema()` en SQL crudo sobre la conexión CON pooler (pgbouncer) de
// Neon para decidir qué tablas truncar. Las queries TIPADAS de Prisma nunca
// tuvieron problema (van con el nombre del schema ya resuelto dentro del SQL
// que generan), pero `current_schema()` en una query cruda depende del
// `search_path` de la sesión — y con pooling esa sesión puede no ser la que
// uno espera. Resultado: un TRUNCATE que debía limpiar `test_integration`
// terminó limpiando `public`, borrando los datos de desarrollo. Por eso
// ahora: (1) conexión directa, sin pooler, y (2) el nombre del schema viene
// de una variable de entorno explícita (TEST_SCHEMA_NAME), nunca de
// preguntarle a Postgres "¿cuál es mi schema actual?".
const TEST_SCHEMA_NAME = process.env.TEST_SCHEMA_NAME;

if (!TEST_SCHEMA_NAME || TEST_SCHEMA_NAME === "public") {
  throw new Error(
    "TEST_SCHEMA_NAME debe estar definido en .env.test y NUNCA puede ser 'public' " +
      "(es justamente la protección contra volver a truncar la base de desarrollo)."
  );
}

// `process.env.DIRECT_URL` ya viene resuelto por tests/setupEnv.ts para
// cualquiera de los dos modos (branch fija o efímera) — no se lee
// DIRECT_URL_TEST directamente acá para no tener dos lugares que puedan
// quedar desincronizados sobre cuál es la conexión real de esta corrida.
export const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

// Deja la base de test vacía entre tests. La lógica real vive en
// tests/dbReset.ts (compartida con la limpieza inicial de la branch efímera
// en globalSetup.ts), para no tener dos implementaciones del mismo TRUNCATE
// que puedan divergir.
export async function resetDatabase() {
  await truncateAllTables(prisma, TEST_SCHEMA_NAME);
}

export async function createTestUser(role: Role) {
  const user = await prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${randomUUID()}@test.local`,
      // Costo bajo a propósito: en tests no importa la seguridad del hash,
      // sí la velocidad (se crea un usuario por test varias veces).
      passwordHash: await bcrypt.hash("Test123!", 4),
      name: `Test ${role}`,
      role,
    },
  });
  const token = signToken({ id: user.id, email: user.email, role: user.role });
  return { user, token };
}

export async function createCategoryFixture() {
  const category = await prisma.category.create({ data: { name: `Categoría ${randomUUID()}` } });
  const subcategory = await prisma.subcategory.create({
    data: { name: `Subcategoría ${randomUUID()}`, categoryId: category.id },
  });
  return { category, subcategory };
}

export async function createProductFixture(overrides: {
  categoryId: string;
  subcategoryId?: string | null;
  status?: ProductStatus;
}) {
  return prisma.product.create({
    data: {
      sku: `SKU-${randomUUID().slice(0, 8).toUpperCase()}`,
      name: "Producto de prueba",
      categoryId: overrides.categoryId,
      subcategoryId: overrides.subcategoryId ?? undefined,
      status: overrides.status ?? ProductStatus.ACTIVE,
    },
  });
}

export async function createVariantFixture(overrides: {
  productId: string;
  stock?: number;
  reservedStock?: number;
  minStock?: number | null;
}) {
  return prisma.productVariant.create({
    data: {
      productId: overrides.productId,
      sku: `VAR-${randomUUID().slice(0, 8).toUpperCase()}`,
      attributes: { color: "Negro" },
      label: "Negro",
      stock: overrides.stock ?? 0,
      reservedStock: overrides.reservedStock ?? 0,
      minStock: overrides.minStock ?? undefined,
    },
  });
}

export async function createSupplierFixture() {
  return prisma.supplier.create({ data: { name: `Proveedor ${randomUUID()}` } });
}

export async function createImportBatchFixture(overrides?: { supplierId?: string }) {
  return prisma.importBatch.create({
    data: {
      reference: `CONT-${randomUUID().slice(0, 8).toUpperCase()}`,
      arrivalDate: new Date(),
      supplierId: overrides?.supplierId,
    },
  });
}

function randomRuc(): string {
  return Array.from({ length: 13 }, () => Math.floor(Math.random() * 10)).join("");
}

export async function createWholesalerFixture(overrides?: { defaultCreditDays?: number | null }) {
  return prisma.wholesaler.create({
    data: {
      businessName: `Mayorista ${randomUUID()}`,
      ruc: randomRuc(),
      defaultCreditDays: overrides?.defaultCreditDays ?? undefined,
    },
  });
}

export async function createFinalCustomerFixture() {
  return prisma.finalCustomer.create({ data: { fullName: `Cliente ${randomUUID()}` } });
}

export async function createCourierFixture() {
  return prisma.courier.create({ data: { name: `Courier ${randomUUID()}` } });
}

export async function createWarehouseFixture() {
  return prisma.warehouse.create({ data: { name: `Bodega ${randomUUID()}` } });
}

export async function createLocationFixture(overrides?: { warehouseId?: string; code?: string }) {
  const warehouseId = overrides?.warehouseId ?? (await createWarehouseFixture()).id;
  return prisma.location.create({
    data: { warehouseId, code: overrides?.code ?? `LOC-${randomUUID().slice(0, 8).toUpperCase()}` },
  });
}

export async function createBrandFixture() {
  return prisma.brand.create({ data: { name: `Marca ${randomUUID()}` } });
}

// Variante con un INGRESO real ya aplicado — la necesitan los tests de
// Despachos para que computeWeightedAverageCost tenga de dónde sacar
// unitCostSnapshot (sin esto, el promedio ponderado daría 0).
export async function createVariantWithIngreso(overrides: {
  productId: string;
  quantity: number;
  unitCost: number;
}) {
  const variant = await createVariantFixture({
    productId: overrides.productId,
    stock: overrides.quantity,
  });
  await prisma.inventoryMovement.create({
    data: {
      variantId: variant.id,
      type: "INGRESO",
      quantity: overrides.quantity,
      unitCost: overrides.unitCost,
      stockAfter: overrides.quantity,
    },
  });
  return variant;
}
