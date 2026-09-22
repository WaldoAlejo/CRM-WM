import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createLocationFixture, createTestUser, createWarehouseFixture, prisma, resetDatabase } from "./helpers";

const app = createApp();

afterEach(async () => {
  await resetDatabase();
});

describe("POST /api/warehouses", () => {
  it("ADMIN puede crear una bodega", async () => {
    const { token } = await createTestUser("ADMIN");
    const res = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bodega Central", address: "Av. Principal 123" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Bodega Central");
    expect(res.body.isActive).toBe(true);
  });

  it("OPERATOR recibe 403", async () => {
    const { token } = await createTestUser("OPERATOR");
    const res = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Otra Bodega" });

    expect(res.status).toBe(403);
  });

  it("409 si ya existe una bodega con ese nombre", async () => {
    const { token } = await createTestUser("ADMIN");
    await request(app).post("/api/warehouses").set("Authorization", `Bearer ${token}`).send({ name: "Duplicada" });

    const res = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Duplicada" });

    expect(res.status).toBe(409);
  });
});

describe("POST /api/warehouses — campos operativos y responsable", () => {
  it("ADMIN crea con capacity/phone/notes/managerId; el responsable (ADMIN, OPERATOR o CEO) queda incluido en la respuesta", async () => {
    const { token } = await createTestUser("ADMIN");

    for (const role of ["ADMIN", "OPERATOR", "CEO"] as const) {
      const { user: manager } = await createTestUser(role);
      const res = await request(app)
        .post("/api/warehouses")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: `Bodega con responsable ${role}`,
          address: "Av. Principal 123",
          capacity: 500,
          phone: "0991234567",
          notes: "Bodega principal de la zona norte",
          managerId: manager.id,
        });

      expect(res.status, role).toBe(201);
      expect(res.body).toMatchObject({
        capacity: 500,
        phone: "0991234567",
        notes: "Bodega principal de la zona norte",
        manager: { id: manager.id, name: manager.name, role },
      });
    }
  });

  it("CEO también puede crear bodegas sin límite, como ADMIN", async () => {
    const { token } = await createTestUser("CEO");
    const res = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bodega creada por CEO" });
    expect(res.status).toBe(201);
  });

  it("los 4 campos son opcionales: se puede crear sin ninguno", async () => {
    const { token } = await createTestUser("ADMIN");
    const res = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bodega mínima" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ capacity: null, phone: null, notes: null, manager: null });
  });

  it("400 si managerId no existe, o si el usuario está inactivo — nunca se asigna un responsable inválido", async () => {
    const { token } = await createTestUser("ADMIN");
    const { user: inactive } = await createTestUser("ADMIN");
    const { token: otherAdminToken } = await createTestUser("ADMIN");
    // Se desactiva a través del propio endpoint de usuarios para no saltarse las reglas.
    await request(app)
      .patch(`/api/users/${inactive.id}`)
      .set("Authorization", `Bearer ${otherAdminToken}`)
      .send({ isActive: false });

    const noExiste = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bodega X", managerId: "no-existe" });
    expect(noExiste.status).toBe(400);
    expect(noExiste.body.field).toBe("managerId");

    const inactivo = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bodega Y", managerId: inactive.id });
    expect(inactivo.status).toBe(400);
    expect(inactivo.body.field).toBe("managerId");

    expect(await prisma.warehouse.count({ where: { name: { in: ["Bodega X", "Bodega Y"] } } })).toBe(0);
  });

  it("la Cuarentena se sigue generando automáticamente, activa, tipo CUARENTENA, y sigue sin poder eliminarse", async () => {
    const { token } = await createTestUser("ADMIN");
    const created = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bodega con Cuarentena", capacity: 100 });

    const quarantine = await prisma.location.findFirstOrThrow({
      where: { warehouseId: created.body.id, type: "CUARENTENA" },
    });
    expect(quarantine.isActive).toBe(true);
    expect(quarantine.code).toBe("Cuarentena");

    // No aparece en el listado normal de ubicaciones de la bodega…
    const locations = await request(app)
      .get(`/api/warehouses/${created.body.id}/locations`)
      .set("Authorization", `Bearer ${token}`);
    expect(locations.body).toEqual([]);

    // …y sigue sin poder eliminarse por la ruta normal de ubicaciones (404, la
    // misma protección de siempre: ese endpoint solo ve ubicaciones STANDARD).
    const del = await request(app)
      .delete(`/api/locations/${quarantine.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(404);
    expect((await prisma.location.findUniqueOrThrow({ where: { id: quarantine.id } })).isActive).toBe(true);
  });
});

describe("GET /api/warehouses", () => {
  it("incluye las ubicaciones activas anidadas", async () => {
    const { token } = await createTestUser("OPERATOR");
    const warehouse = await createWarehouseFixture();
    await createLocationFixture({ warehouseId: warehouse.id, code: "A-1" });

    const res = await request(app).get("/api/warehouses").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const found = res.body.find((w: { id: string }) => w.id === warehouse.id);
    expect(found.locations).toHaveLength(1);
    expect(found.locations[0].code).toBe("A-1");
  });

  it("cualquier usuario autenticado puede consultar (OPERATOR incluido)", async () => {
    const { token } = await createTestUser("OPERATOR");
    const res = await request(app).get("/api/warehouses").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/warehouses/:id", () => {
  it("ADMIN puede editar, OPERATOR recibe 403", async () => {
    const { token: adminToken } = await createTestUser("ADMIN");
    const { token: operatorToken } = await createTestUser("OPERATOR");
    const warehouse = await createWarehouseFixture();

    const forbidden = await request(app)
      .patch(`/api/warehouses/${warehouse.id}`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ address: "Nueva dirección" });
    expect(forbidden.status).toBe(403);

    const ok = await request(app)
      .patch(`/api/warehouses/${warehouse.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ address: "Nueva dirección" });
    expect(ok.status).toBe(200);
    expect(ok.body.address).toBe("Nueva dirección");
  });

  it("edita capacity/phone/notes/managerId, y CEO también puede editar (hereda de ADMIN)", async () => {
    const { token: ceoToken } = await createTestUser("CEO");
    const { user: manager } = await createTestUser("OPERATOR");
    const warehouse = await createWarehouseFixture();

    const res = await request(app)
      .patch(`/api/warehouses/${warehouse.id}`)
      .set("Authorization", `Bearer ${ceoToken}`)
      .send({ capacity: 250, phone: "022345678", notes: "Reorganizada en septiembre", managerId: manager.id });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      capacity: 250,
      phone: "022345678",
      notes: "Reorganizada en septiembre",
      manager: { id: manager.id, role: "OPERATOR" },
    });
  });

  it("managerId: null limpia el responsable explícitamente (reasignar antes de desactivar al usuario)", async () => {
    const { token } = await createTestUser("ADMIN");
    const { user: manager } = await createTestUser("ADMIN");
    const warehouse = await createWarehouseFixture();
    await prisma.warehouse.update({ where: { id: warehouse.id }, data: { managerId: manager.id } });

    const res = await request(app)
      .patch(`/api/warehouses/${warehouse.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ managerId: null });

    expect(res.status).toBe(200);
    expect(res.body.manager).toBeNull();
    expect((await prisma.warehouse.findUniqueOrThrow({ where: { id: warehouse.id } })).managerId).toBeNull();
  });

  it("400 si el managerId indicado no existe o no está activo", async () => {
    const { token } = await createTestUser("ADMIN");
    const warehouse = await createWarehouseFixture();

    const res = await request(app)
      .patch(`/api/warehouses/${warehouse.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ managerId: "no-existe" });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("managerId");
  });
});

describe("DELETE /api/warehouses/:id", () => {
  it("pone isActive=false y la saca del listado/GET por id", async () => {
    const { token } = await createTestUser("ADMIN");
    const warehouse = await createWarehouseFixture();

    const res = await request(app)
      .delete(`/api/warehouses/${warehouse.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    const stored = await prisma.warehouse.findUniqueOrThrow({ where: { id: warehouse.id } });
    expect(stored.isActive).toBe(false);

    const getRes = await request(app)
      .get(`/api/warehouses/${warehouse.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(404);
  });

  it("409 si tiene ubicaciones activas — hay que eliminarlas primero", async () => {
    const { token } = await createTestUser("ADMIN");
    const warehouse = await createWarehouseFixture();
    await createLocationFixture({ warehouseId: warehouse.id });

    const res = await request(app)
      .delete(`/api/warehouses/${warehouse.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);

    const stored = await prisma.warehouse.findUniqueOrThrow({ where: { id: warehouse.id } });
    expect(stored.isActive).toBe(true);
  });
});
