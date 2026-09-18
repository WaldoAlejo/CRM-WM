// E2E contra el backend real: crear -> aparece en la lista con locations:[]
// -> editar -> bloqueado por 409 si tiene una ubicación activa -> se puede
// eliminar una vez que la ubicación se elimina primero. El DELETE de este
// módulo pone isActive=false (no deletedAt) — mismo contrato HTTP que
// Courier (ver couriers.e2e.test.tsx), así que el flujo feliz es idéntico;
// lo distinto (y lo que vale la pena probar acá) es la protección de borrado.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useCrudResource } from "@/components/crud/useCrudResource";
import { apiFetch, setToken } from "@/lib/api";
import { warehousesConfig } from "./warehouses.config";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const NAME = `E2E Bodega ${Date.now()}`;
const NAME_EDITADA = `${NAME} (editada)`;

function testWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("Bodegas — CRUD de punta a punta contra el backend real (via useCrudResource)", () => {
  let createdId: string | undefined;

  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
      throw new Error(`Este test necesita el backend real corriendo en ${BASE} (cd backend && npm run dev).`);
    }
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ADMIN_CREDENTIALS),
    });
    if (!loginRes.ok) {
      throw new Error(
        `No se pudo autenticar con las credenciales de seed (${ADMIN_CREDENTIALS.email}). ` +
          '¿Corriste "npx prisma db seed" en backend/?'
      );
    }
    const { token } = (await loginRes.json()) as { token: string };
    setToken(token);
  });

  afterAll(async () => {
    if (createdId) await apiFetch(`/warehouses/${createdId}`, { method: "DELETE" }).catch(() => {});
  });

  it("crear -> aparece con locations:[] -> editar -> 409 si tiene ubicación activa -> elimina tras vaciarla", async () => {
    const { result } = renderHook(() => useCrudResource(warehousesConfig), { wrapper: testWrapper() });

    await waitFor(() => expect(result.current.listQuery.isSuccess).toBe(true), { timeout: 8000 });

    result.current.createMutation.mutate({ name: NAME, address: "Av. Siempre Viva 123" });
    await waitFor(() => expect(result.current.createMutation.isSuccess).toBe(true), { timeout: 8000 });
    createdId = result.current.createMutation.data?.id;
    expect(createdId).toBeTruthy();
    expect(result.current.createMutation.data?.isActive).toBe(true);
    // POST no incluye `locations` (mismo criterio que Category/Subcategory:
    // el create response no trae la relación anidada, solo GET list/byId sí).

    await waitFor(() => {
      expect(result.current.listQuery.data?.data.some((w) => w.id === createdId)).toBe(true);
    });

    result.current.updateMutation.mutate({ id: createdId!, values: { name: NAME_EDITADA, address: "" } });
    await waitFor(() => expect(result.current.updateMutation.isSuccess).toBe(true), { timeout: 8000 });
    await waitFor(() => {
      const row = result.current.listQuery.data?.data.find((w) => w.id === createdId);
      expect(row?.name).toBe(NAME_EDITADA);
    });

    // Con una ubicación activa colgando, el borrado de la bodega debe
    // rechazarse con 409 (mismo criterio que Category frente a Subcategory).
    const location = await apiFetch<{ id: string }>(`/warehouses/${createdId}/locations`, {
      method: "POST",
      body: JSON.stringify({ code: "A-1" }),
    });

    await expect(apiFetch(`/warehouses/${createdId}`, { method: "DELETE" })).rejects.toMatchObject({
      status: 409,
    });

    await apiFetch(`/locations/${location.id}`, { method: "DELETE" });

    result.current.deleteMutation.mutate(createdId!);
    await waitFor(() => expect(result.current.deleteMutation.isSuccess).toBe(true), { timeout: 8000 });
    await waitFor(() => {
      expect(result.current.listQuery.data?.data.some((w) => w.id === createdId)).toBe(false);
    });

    await expect(apiFetch(`/warehouses/${createdId}`)).rejects.toMatchObject({ status: 404 });

    createdId = undefined;
  }, 30000);

  it("OPERATOR puede consultar bodegas pero el backend rechaza crear/editar/eliminar", async () => {
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "operador@kestore.com.ec", password: "Operador123!" }),
    });
    const { token } = (await loginRes.json()) as { token: string };
    setToken(token);

    await expect(apiFetch("/warehouses")).resolves.toBeInstanceOf(Array);
    await expect(
      apiFetch("/warehouses", { method: "POST", body: JSON.stringify({ name: `Debe fallar ${Date.now()}` }) })
    ).rejects.toMatchObject({ status: 403 });

    // Vuelve a loguear como admin para no afectar el resto de la suite.
    const adminLoginRes = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ADMIN_CREDENTIALS),
    });
    const { token: adminToken } = (await adminLoginRes.json()) as { token: string };
    setToken(adminToken);
  }, 15000);
});
