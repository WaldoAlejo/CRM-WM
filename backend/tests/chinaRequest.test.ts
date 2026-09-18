import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import {
  createCategoryFixture,
  createProductFixture,
  createTestUser,
  createVariantFixture,
  prisma,
  resetDatabase,
} from "./helpers";

const app = createApp();

afterEach(async () => {
  await resetDatabase();
});

// Claves EXACTAS que puede traer una línea de la lista: cualquier campo
// nuevo (sobre todo de costo/precio) hace fallar este test.
const ALLOWED_LINE_KEYS = ["description", "imageUrl", "productName", "stock", "variantId", "variantLabel"];

const FORBIDDEN_KEY_PATTERN = /cost|price|precio|costo|discount|margin|profit|wholesale|retail|cny/i;

function allKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, keys));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      keys.add(k);
      allKeys(v, keys);
    }
  }
  return keys;
}

async function lowStockVariantWithSecrets(stock = 3) {
  const { category } = await createCategoryFixture();
  const product = await createProductFixture({ categoryId: category.id });
  await prisma.product.update({ where: { id: product.id }, data: { description: "Freidora de aire 5L" } });
  await prisma.productImage.create({ data: { productId: product.id, url: "/uploads/products/x/portada.jpg" } });
  const variant = await createVariantFixture({ productId: product.id, stock });
  // Datos sensibles con valores reconocibles: no deben aparecer jamás.
  await prisma.productVariant.update({
    where: { id: variant.id },
    data: { costPriceCNY: 987.65, wholesalePrice: 111.11, retailPrice: 222.22, wholesaleDiscountPct: 5, retailDiscountPct: 7 },
  });
  return { product, variant };
}

describe("GET /api/purchasing/china-request/low-stock", () => {
  it("cada línea trae SOLO los campos permitidos, para CEO, ADMIN y OPERATOR (clave ausente, no null)", async () => {
    const { variant } = await lowStockVariantWithSecrets();

    for (const role of ["CEO", "ADMIN", "OPERATOR"] as const) {
      const { token } = await createTestUser(role);
      const res = await request(app)
        .get("/api/purchasing/china-request/low-stock")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status, role).toBe(200);
      const line = res.body.data.find((l: { variantId: string }) => l.variantId === variant.id);
      expect(Object.keys(line).sort(), role).toEqual(ALLOWED_LINE_KEYS);
      // Ninguna clave en TODA la respuesta parece costo/precio…
      const offending = [...allKeys(res.body)].filter((k) => FORBIDDEN_KEY_PATTERN.test(k));
      expect(offending, role).toEqual([]);
      // …ni aparece ninguno de los valores sensibles sembrados.
      const raw = JSON.stringify(res.body);
      for (const secret of ["987.65", "111.11", "222.22"]) expect(raw, role).not.toContain(secret);
    }
  });

  it("incluye descripción e imagen (portada del producto) y respeta el umbral < 10", async () => {
    const { token } = await createTestUser("CEO");
    const { variant: low } = await lowStockVariantWithSecrets(9);
    const { variant: ok } = await lowStockVariantWithSecrets(10);

    const res = await request(app)
      .get("/api/purchasing/china-request/low-stock")
      .set("Authorization", `Bearer ${token}`);
    const ids = res.body.data.map((l: { variantId: string }) => l.variantId);
    expect(ids).toContain(low.id); // 9 < 10
    expect(ids).not.toContain(ok.id); // 10 no es < 10
    expect(res.body.threshold).toBe(10);

    const line = res.body.data.find((l: { variantId: string }) => l.variantId === low.id);
    expect(line.description).toBe("Freidora de aire 5L");
    expect(line.imageUrl).toBe("/uploads/products/x/portada.jpg");
  });

  it("NO usa minStock (criterio distinto al del Dashboard): stock 50 con minStock 100 no aparece; stock 5 con minStock 0 sí", async () => {
    const { token } = await createTestUser("CEO");
    const { category } = await createCategoryFixture();
    const product = await createProductFixture({ categoryId: category.id });
    const aboveThresholdBelowMin = await createVariantFixture({ productId: product.id, stock: 50, minStock: 100 });
    const belowThresholdNoMin = await createVariantFixture({ productId: product.id, stock: 5, minStock: 0 });

    const res = await request(app)
      .get("/api/purchasing/china-request/low-stock")
      .set("Authorization", `Bearer ${token}`);
    const ids = res.body.data.map((l: { variantId: string }) => l.variantId);
    expect(ids).not.toContain(aboveThresholdBelowMin.id);
    expect(ids).toContain(belowThresholdNoMin.id);
  });

  it("excluye variantes eliminadas/inactivas y productos descontinuados; acepta ?threshold", async () => {
    const { token } = await createTestUser("CEO");
    const { category } = await createCategoryFixture();
    const active = await createProductFixture({ categoryId: category.id });
    const discontinued = await createProductFixture({ categoryId: category.id, status: "DISCONTINUED" });
    const okVariant = await createVariantFixture({ productId: active.id, stock: 15 });
    const deleted = await createVariantFixture({ productId: active.id, stock: 1 });
    await prisma.productVariant.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    const ofDiscontinued = await createVariantFixture({ productId: discontinued.id, stock: 1 });

    const res = await request(app)
      .get("/api/purchasing/china-request/low-stock?threshold=20")
      .set("Authorization", `Bearer ${token}`);
    const ids = res.body.data.map((l: { variantId: string }) => l.variantId);
    expect(ids).toContain(okVariant.id); // 15 < 20
    expect(ids).not.toContain(deleted.id);
    expect(ids).not.toContain(ofDiscontinued.id);
    expect(res.body.threshold).toBe(20);
  });

  it("requiere autenticación", async () => {
    const res = await request(app).get("/api/purchasing/china-request/low-stock");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/purchasing/china-request/pdf", () => {
  it("CEO descarga un PDF válido (application/pdf, empieza con %PDF, attachment)", async () => {
    const { token } = await createTestUser("CEO");
    const { variant } = await lowStockVariantWithSecrets();

    const res = await request(app)
      .post("/api/purchasing/china-request/pdf")
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .send({ items: [{ variantId: variant.id, quantity: 25 }] });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="solicitud-proveedor-/);
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(body.length).toBeGreaterThan(500);
  });

  it("ADMIN y OPERATOR NO pueden generar ni descargar el PDF (403), ni sin token (401)", async () => {
    const { variant } = await lowStockVariantWithSecrets();
    const body = { items: [{ variantId: variant.id, quantity: 5 }] };

    for (const role of ["ADMIN", "OPERATOR"] as const) {
      const { token } = await createTestUser(role);
      const res = await request(app)
        .post("/api/purchasing/china-request/pdf")
        .set("Authorization", `Bearer ${token}`)
        .send(body);
      expect(res.status, role).toBe(403);
      // La respuesta de rechazo no es un PDF.
      expect(res.headers["content-type"], role).not.toMatch(/pdf/);
    }

    const anon = await request(app).post("/api/purchasing/china-request/pdf").send(body);
    expect(anon.status).toBe(401);
  });

  it("valida la selección: vacía, cantidad inválida, repetidos y variantes inexistentes → 400", async () => {
    const { token } = await createTestUser("CEO");
    const { variant } = await lowStockVariantWithSecrets();
    const send = (body: unknown) =>
      request(app).post("/api/purchasing/china-request/pdf").set("Authorization", `Bearer ${token}`).send(body as object);

    expect((await send({ items: [] })).status).toBe(400);
    expect((await send({ items: [{ variantId: variant.id, quantity: 0 }] })).status).toBe(400);
    expect((await send({ items: [{ variantId: variant.id, quantity: 1.5 }] })).status).toBe(400);
    expect(
      (await send({ items: [{ variantId: variant.id, quantity: 1 }, { variantId: variant.id, quantity: 2 }] })).status
    ).toBe(400);
    expect((await send({ items: [{ variantId: "no-existe", quantity: 1 }] })).status).toBe(400);
  });

  it("generar el PDF no descuenta ni compromete stock (es solo un documento)", async () => {
    const { token } = await createTestUser("CEO");
    const { variant } = await lowStockVariantWithSecrets(4);

    await request(app)
      .post("/api/purchasing/china-request/pdf")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ variantId: variant.id, quantity: 100 }] });

    const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(after.stock).toBe(4);
    expect(after.reservedStock).toBe(0);
    expect(await prisma.inventoryMovement.count({ where: { variantId: variant.id } })).toBe(0);
  });
});
