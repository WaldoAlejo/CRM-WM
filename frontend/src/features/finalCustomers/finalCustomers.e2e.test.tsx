// E2E contra el backend real. El punto central pedido explícitamente: un
// usuario OPERATOR puede crear un cliente final (a diferencia de
// Suppliers/Brands/Couriers, donde permissions.create es admin-only) —
// backend/src/modules/finalCustomers/finalCustomers.routes.ts no tiene
// requireRole en el POST.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useCrudResource } from "@/components/crud/useCrudResource";
import { apiFetch, setToken } from "@/lib/api";
import { finalCustomersConfig } from "./finalCustomers.config";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const OPERATOR_CREDENTIALS = { email: "operador@kestore.com.ec", password: "Operador123!" };
const NAME = `E2E Cliente ${Date.now()}`;

function testWrapper() {
  // renderHook observa data fuera del render: recibir también refetches rápidos.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, notifyOnChangeProps: "all" } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

async function login(credentials: { email: string; password: string }) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  if (!res.ok) {
    throw new Error(
      `No se pudo autenticar como ${credentials.email}. ¿Corriste "npx prisma db seed" en backend/?`
    );
  }
  return ((await res.json()) as { token: string }).token;
}

describe("FinalCustomers — POST abierto a OPERATOR (a diferencia de los otros 3 módulos de catálogo)", () => {
  let adminToken: string;
  let operatorToken: string;
  let createdId: string | undefined;

  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
      throw new Error(`Este test necesita el backend real corriendo en ${BASE} (cd backend && npm run dev).`);
    }
    adminToken = await login(ADMIN_CREDENTIALS);
    operatorToken = await login(OPERATOR_CREDENTIALS);
  });

  afterAll(async () => {
    if (createdId) {
      setToken(adminToken); // el DELETE es admin-only
      await apiFetch(`/final-customers/${createdId}`, { method: "DELETE" }).catch(() => {});
    }
  });

  it("un usuario OPERATOR puede crear un cliente final (201, no 403)", async () => {
    setToken(operatorToken);
    const { result } = renderHook(() => useCrudResource(finalCustomersConfig), { wrapper: testWrapper() });

    await waitFor(() => expect(result.current.listQuery.isSuccess).toBe(true), { timeout: 8000 });

    // OJO: acá se llama a createMutation.mutate() directo, sin pasar por
    // CrudFormDialog/zodResolver — así que el preprocess "" -> undefined de
    // optionalEmail() (finalCustomers.schema.ts) NUNCA se ejecuta. El
    // backend rechaza email:"" con 400 (falla su propio .email()), así que
    // acá se manda undefined explícito para los opcionales sin usar,
    // reproduciendo lo que el formulario real SÍ le entregaría a la mutación.
    result.current.createMutation.mutate({
      fullName: NAME,
      idType: "CEDULA",
      idNumber: undefined,
      phone: undefined,
      email: undefined,
      address: undefined,
    });

    await waitFor(() => expect(result.current.createMutation.isSuccess).toBe(true), { timeout: 8000 });
    createdId = result.current.createMutation.data?.id;
    expect(createdId).toBeTruthy();

    await waitFor(
      () => {
        expect(result.current.listQuery.data?.data.some((c) => c.id === createdId)).toBe(true);
      },
      { timeout: 8000 }
    );
  }, 30000);

  it("en cambio, un OPERATOR recibe 403 al intentar EDITAR (admin-only, a diferencia del create)", async () => {
    expect(createdId).toBeTruthy();
    setToken(operatorToken);

    await expect(
      apiFetch(`/final-customers/${createdId}`, {
        method: "PATCH",
        body: JSON.stringify({ fullName: "Intento no autorizado" }),
      })
    ).rejects.toMatchObject({ status: 403 });
  });
});
