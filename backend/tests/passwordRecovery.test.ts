import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { setMailerForTests, type MailMessage } from "../src/lib/mailer";
import { resetRateLimitsForTests } from "../src/modules/auth/passwordTokens";
import { createTestUser, prisma, resetDatabase } from "./helpers";

const app = createApp();
const sent: MailMessage[] = [];
beforeAll(() => {
  process.env.APP_URL = "https://app.test";
  setMailerForTests({ send: async (message) => { sent.push(message); } });
});
afterAll(() => { setMailerForTests(undefined); delete process.env.APP_URL; });
afterEach(async () => { sent.length = 0; resetRateLimitsForTests(); await resetDatabase(); });

const tokenFrom = (message: MailMessage) => /reset-password\?token=([\w-]+)/.exec(message.text)![1];
const login = (email: string, password: string) => request(app).post("/api/auth/login").send({ email, password });

describe("Recuperación de contraseña por correo", () => {
  it("envía un enlace de un solo uso que permite cambiar la contraseña", async () => {
    const { user } = await createTestUser("OPERATOR");
    const res = await request(app).post("/api/auth/forgot-password").send({ email: user.email.toUpperCase() });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(user.email);
    expect(sent[0].text).toContain("https://app.test/reset-password?token=");
    const token = tokenFrom(sent[0]);
    expect(JSON.stringify(await prisma.passwordToken.findMany())).not.toContain(token); // solo el hash

    const described = await request(app).post("/api/auth/password-token").send({ token });
    expect(described.body).toMatchObject({ email: user.email, purpose: "RESET" });
    await request(app).post("/api/auth/reset-password").send({ token, password: "corta" }).expect(400);
    await request(app).post("/api/auth/reset-password").send({ token, password: "NuevaClave123" }).expect(200);

    expect((await login(user.email, "Test123!")).status).toBe(401);
    expect((await login(user.email.toUpperCase(), "NuevaClave123")).status).toBe(200);
    const reused = await request(app).post("/api/auth/reset-password").send({ token, password: "OtraClave123" });
    expect(reused.status).toBe(400);
    expect(reused.body.error).toContain("no es válido");
  });

  it("no revela si la cuenta existe ni envía a usuarios inactivos", async () => {
    const { user } = await createTestUser("OPERATOR");
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    const unknown = await request(app).post("/api/auth/forgot-password").send({ email: "nadie@example.com" });
    const inactive = await request(app).post("/api/auth/forgot-password").send({ email: user.email });
    expect(unknown.status).toBe(200); expect(inactive.status).toBe(200);
    expect(unknown.body).toEqual(inactive.body);
    expect(sent).toHaveLength(0);
  });

  it("limita las solicitudes por correo y rechaza enlaces vencidos", async () => {
    const { user } = await createTestUser("OPERATOR");
    for (let i = 0; i < 5; i++) await request(app).post("/api/auth/forgot-password").send({ email: user.email }).expect(200);
    expect(sent).toHaveLength(3);
    await prisma.passwordToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await request(app).post("/api/auth/reset-password").send({ token: tokenFrom(sent[0]), password: "NuevaClave123" }).expect(400);
  });

  it("al usar un enlace invalida los demás pendientes", async () => {
    const { user } = await createTestUser("OPERATOR");
    await request(app).post("/api/auth/forgot-password").send({ email: user.email });
    await request(app).post("/api/auth/forgot-password").send({ email: user.email });
    await request(app).post("/api/auth/reset-password").send({ token: tokenFrom(sent[1]), password: "NuevaClave123" }).expect(200);
    await request(app).post("/api/auth/reset-password").send({ token: tokenFrom(sent[0]), password: "OtraClave123" }).expect(400);
  });
});

describe("Invitación y cambio de contraseña", () => {
  it("crear un usuario sin contraseña le envía la invitación (72 h) y guarda el correo en minúsculas", async () => {
    const { token } = await createTestUser("ADMIN");
    const res = await request(app).post("/api/users").set("Authorization", `Bearer ${token}`)
      .send({ email: "  Juan.Perez@Gmail.com ", name: "Juan", role: "OPERATOR" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: "juan.perez@gmail.com", invitation: { sent: true } });
    expect(sent[0].subject).toContain("Tu acceso");
    const row = await prisma.passwordToken.findFirstOrThrow();
    expect(row.purpose).toBe("INVITE");
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(71 * 3600_000);
    await request(app).post("/api/auth/reset-password").send({ token: tokenFrom(sent[0]), password: "MiClave2026" }).expect(200);
    expect((await login("JUAN.PEREZ@gmail.com", "MiClave2026")).status).toBe(200);
  });

  it("el usuario se crea aunque no haya correo configurado y la respuesta lo indica", async () => {
    setMailerForTests(null);
    try {
      const { token } = await createTestUser("ADMIN");
      const res = await request(app).post("/api/users").set("Authorization", `Bearer ${token}`).send({ email: "ana@example.com", name: "Ana", role: "OPERATOR" });
      expect(res.status).toBe(201);
      expect(res.body.invitation.sent).toBe(false);
      expect(await prisma.passwordToken.count()).toBe(0);
    } finally { setMailerForTests({ send: async (message) => { sent.push(message); } }); }
  });

  it("ADMIN envía enlace de acceso, pero no a un CEO", async () => {
    const admin = await createTestUser("ADMIN");
    const operator = await createTestUser("OPERATOR");
    const ceo = await createTestUser("CEO");
    const ok = await request(app).post(`/api/users/${operator.user.id}/send-access-link`).set("Authorization", `Bearer ${admin.token}`);
    expect(ok.status).toBe(200); expect(ok.body.sentTo).toBe(operator.user.email);
    await request(app).post(`/api/users/${ceo.user.id}/send-access-link`).set("Authorization", `Bearer ${admin.token}`).expect(403);
  });

  it("cambia la propia contraseña verificando la actual", async () => {
    const { user, token } = await createTestUser("OPERATOR");
    const auth = { Authorization: `Bearer ${token}` };
    const wrong = await request(app).post("/api/auth/change-password").set(auth).send({ currentPassword: "mala", newPassword: "NuevaClave123" });
    expect(wrong.status).toBe(400); expect(wrong.body.field).toBe("currentPassword");
    await request(app).post("/api/auth/change-password").set(auth).send({ currentPassword: "Test123!", newPassword: "NuevaClave123" }).expect(200);
    expect((await login(user.email, "NuevaClave123")).status).toBe(200);
    await request(app).post("/api/auth/change-password").send({ currentPassword: "x", newPassword: "NuevaClave123" }).expect(401);
  });
});
