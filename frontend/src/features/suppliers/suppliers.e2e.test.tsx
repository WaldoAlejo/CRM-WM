// E2E contra el backend real: crear -> aparece en la lista (esta vez CON
// paginación real, { data, pagination } — a diferencia de Categorías) ->
// editar -> eliminar -> desaparece, todo vía useCrudResource (el mismo hook
// que usa SuppliersPage).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useCrudResource } from "@/components/crud/useCrudResource";
import { apiFetch, setToken } from "@/lib/api";
import { suppliersConfig } from "./suppliers.config";

// Ver categories.e2e.test.tsx: happy-dom repite respuestas GET cacheadas
// ignorando cambios de estado del backend — undici es el fetch real de Node.
globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const NAME = `E2E Proveedor ${Date.now()}`;
const NAME_EDITADO = `${NAME} (editado)`;

function testWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("Suppliers — CRUD de punta a punta contra el backend real (via useCrudResource)", () => {
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
    if (createdId) await apiFetch(`/suppliers/${createdId}`, { method: "DELETE" }).catch(() => {});
  });

  it("crear -> aparece en la lista (con pagination real) -> editar -> eliminar -> desaparece", async () => {
    const { result } = renderHook(() => useCrudResource(suppliersConfig), { wrapper: testWrapper() });

    // Evita la carrera real documentada en categories.e2e.test.tsx: espera
    // el fetch inicial antes de crear, para que el refetch post-invalidación
    // no reutilice esa promesa todavía en vuelo.
    await waitFor(() => expect(result.current.listQuery.isSuccess).toBe(true), { timeout: 8000 });

    result.current.createMutation.mutate({ name: NAME, contactInfo: "WeChat: e2e_test" });
    await waitFor(() => expect(result.current.createMutation.isSuccess).toBe(true), { timeout: 8000 });
    createdId = result.current.createMutation.data?.id;
    expect(createdId).toBeTruthy();

    await waitFor(
      () => {
        expect(result.current.listQuery.data?.pagination).not.toBeNull();
        expect(result.current.listQuery.data?.data.some((s) => s.id === createdId)).toBe(true);
      },
      { timeout: 8000 }
    );

    result.current.updateMutation.mutate({ id: createdId!, values: { name: NAME_EDITADO, contactInfo: "" } });
    await waitFor(() => expect(result.current.updateMutation.isSuccess).toBe(true), { timeout: 8000 });
    await waitFor(
      () => {
        const row = result.current.listQuery.data?.data.find((s) => s.id === createdId);
        expect(row?.name).toBe(NAME_EDITADO);
      },
      { timeout: 8000 }
    );

    result.current.deleteMutation.mutate(createdId!);
    await waitFor(() => expect(result.current.deleteMutation.isSuccess).toBe(true), { timeout: 8000 });
    await waitFor(
      () => {
        expect(result.current.listQuery.data?.data.some((s) => s.id === createdId)).toBe(false);
      },
      { timeout: 8000 }
    );

    createdId = undefined;
  }, 30000);
});
