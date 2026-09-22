// E2E contra el backend real: crear -> aparece en la lista -> editar ->
// eliminar -> desaparece. El DELETE de este módulo pone isActive=false en
// vez de deletedAt en el backend (verificado leyendo
// backend/src/modules/couriers/couriers.service.ts antes de escribir este
// config) — pero el CONTRATO HTTP es idéntico (204 sin body, y el courier
// deja de aparecer en el GET siguiente), así que desde este lado no hace
// falta ningún manejo especial: mismo test que los demás módulos.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useCrudResource } from "@/components/crud/useCrudResource";
import { apiFetch, setToken } from "@/lib/api";
import { couriersConfig } from "./couriers.config";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const NAME = `E2E Courier ${Date.now()}`;
const NAME_EDITADO = `${NAME} (editado)`;

function testWrapper() {
  // renderHook lee los resultados fuera del render; suscribirse a todos los
  // cambios evita perder un refetch rápido antes de observar la propiedad data.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, notifyOnChangeProps: "all" } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("Couriers — CRUD de punta a punta contra el backend real (via useCrudResource)", () => {
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
    if (createdId) await apiFetch(`/couriers/${createdId}`, { method: "DELETE" }).catch(() => {});
  });

  it("crear -> aparece en la lista -> editar -> eliminar (isActive=false server-side) -> desaparece", async () => {
    const { result } = renderHook(() => useCrudResource(couriersConfig), { wrapper: testWrapper() });

    await waitFor(() => expect(result.current.listQuery.isSuccess).toBe(true), { timeout: 8000 });

    result.current.createMutation.mutate({ name: NAME, contactInfo: "0999999999" });
    await waitFor(() => expect(result.current.createMutation.isSuccess).toBe(true), { timeout: 8000 });
    createdId = result.current.createMutation.data?.id;
    expect(createdId).toBeTruthy();
    // isActive=true al crear (nunca se manda desde el form: lo pone el backend por default).
    expect(result.current.createMutation.data?.isActive).toBe(true);

    await waitFor(
      () => {
        expect(result.current.listQuery.data?.data.some((c) => c.id === createdId)).toBe(true);
      },
      { timeout: 8000 }
    );

    result.current.updateMutation.mutate({ id: createdId!, values: { name: NAME_EDITADO, contactInfo: "" } });
    await waitFor(() => expect(result.current.updateMutation.isSuccess).toBe(true), { timeout: 8000 });
    await waitFor(
      () => {
        const row = result.current.listQuery.data?.data.find((c) => c.id === createdId);
        expect(row?.name).toBe(NAME_EDITADO);
      },
      { timeout: 8000 }
    );

    result.current.deleteMutation.mutate(createdId!);
    await waitFor(() => expect(result.current.deleteMutation.isSuccess).toBe(true), { timeout: 8000 });
    await waitFor(
      () => {
        // GET /api/couriers filtra isActive:true server-side: como el
        // "delete" real es isActive=false (no deletedAt), el efecto
        // observable es el mismo que en los demás módulos — desaparece.
        expect(result.current.listQuery.data?.data.some((c) => c.id === createdId)).toBe(false);
      },
      { timeout: 8000 }
    );

    // Confirma el detalle server-side real de "isActive=false" directo por
    // API (no solo "ya no aparece en la lista", que también pasaría con un
    // deletedAt): GET /api/couriers/:id da 404 porque getCourierById también
    // filtra por isActive:true, exactamente como describe couriers.service.ts.
    await expect(apiFetch(`/couriers/${createdId}`)).rejects.toMatchObject({ status: 404 });

    createdId = undefined;
  }, 30000);
});
