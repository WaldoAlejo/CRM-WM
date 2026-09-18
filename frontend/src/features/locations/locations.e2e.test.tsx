// E2E contra el backend real: crear una bodega, y dentro de ella crear una
// ubicación -> aparece en la lista anidada -> editar -> eliminar ->
// desaparece. buildLocationsConfig() es una función (no un objeto constante
// como el resto del catálogo) porque el endpoint depende del warehouseId de
// la URL — este test la arma igual que LocationsPage.tsx lo haría.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useCrudResource } from "@/components/crud/useCrudResource";
import { apiFetch, setToken } from "@/lib/api";
import { buildLocationsConfig } from "./locations.config";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const WAREHOUSE_NAME = `E2E Bodega para Ubicaciones ${Date.now()}`;
const CODE = "A-1-1";
const CODE_EDITADO = "A-1-2";

function testWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("Ubicaciones — CRUD anidado bajo una bodega, de punta a punta contra el backend real", () => {
  let warehouseId: string;
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
    const { token } = (await loginRes.json()) as { token: string };
    setToken(token);

    const warehouse = await apiFetch<{ id: string }>("/warehouses", {
      method: "POST",
      body: JSON.stringify({ name: WAREHOUSE_NAME }),
    });
    warehouseId = warehouse.id;
  });

  afterAll(async () => {
    if (createdId) await apiFetch(`/locations/${createdId}`, { method: "DELETE" }).catch(() => {});
    if (warehouseId) await apiFetch(`/warehouses/${warehouseId}`, { method: "DELETE" }).catch(() => {});
  });

  it("crear -> aparece en la lista anidada -> editar -> eliminar -> desaparece", async () => {
    const config = buildLocationsConfig(warehouseId);
    const { result } = renderHook(() => useCrudResource(config), { wrapper: testWrapper() });

    await waitFor(() => expect(result.current.listQuery.isSuccess).toBe(true), { timeout: 8000 });
    expect(result.current.listQuery.data?.data).toEqual([]);

    result.current.createMutation.mutate({ code: CODE, aisle: "A", shelf: "1", level: "1" });
    await waitFor(() => expect(result.current.createMutation.isSuccess).toBe(true), { timeout: 8000 });
    createdId = result.current.createMutation.data?.id;
    expect(createdId).toBeTruthy();
    expect(result.current.createMutation.data?.warehouseId).toBe(warehouseId);

    await waitFor(() => {
      expect(result.current.listQuery.data?.data.some((l) => l.id === createdId)).toBe(true);
    });

    result.current.updateMutation.mutate({ id: createdId!, values: { code: CODE_EDITADO } });
    await waitFor(() => expect(result.current.updateMutation.isSuccess).toBe(true), { timeout: 8000 });
    await waitFor(() => {
      const row = result.current.listQuery.data?.data.find((l) => l.id === createdId);
      expect(row?.code).toBe(CODE_EDITADO);
    });

    result.current.deleteMutation.mutate(createdId!);
    await waitFor(() => expect(result.current.deleteMutation.isSuccess).toBe(true), { timeout: 8000 });
    await waitFor(() => {
      expect(result.current.listQuery.data?.data.some((l) => l.id === createdId)).toBe(false);
    });

    createdId = undefined;
  }, 30000);

  it("409 al crear un código duplicado en la misma bodega; 404 si la bodega no existe", async () => {
    const first = await apiFetch<{ id: string }>(`/warehouses/${warehouseId}/locations`, {
      method: "POST",
      body: JSON.stringify({ code: "DUP-E2E" }),
    });

    await expect(
      apiFetch(`/warehouses/${warehouseId}/locations`, {
        method: "POST",
        body: JSON.stringify({ code: "DUP-E2E" }),
      })
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      apiFetch("/warehouses/id-inexistente/locations", {
        method: "POST",
        body: JSON.stringify({ code: "X" }),
      })
    ).rejects.toMatchObject({ status: 404 });

    await apiFetch(`/locations/${first.id}`, { method: "DELETE" });
  }, 15000);
});
