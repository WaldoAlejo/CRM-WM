// Prueba de punta a punta contra el BACKEND REAL: crear → aparece en la
// lista → editar → eliminar → desaparece de la lista, todo a través de
// useCrudResource (el mismo hook que usa CategoriesPage), no una
// reimplementación paralela. Categorías es además el caso "sin paginación"
// (GET /api/categories devuelve un array plano) — confirma en la práctica
// que normalizeListResponse maneja ese caso real, no solo en un test unitario
// con datos inventados.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useCrudResource } from "@/components/crud/useCrudResource";
import { apiFetch, setToken } from "@/lib/api";
import { categoriesConfig } from "./categories.config";

// happy-dom (el entorno de este test, necesario para renderHook) tiene un
// bug real en su polyfill de fetch: repite la MISMA respuesta cacheada para
// GETs idénticos a una URL aunque el servidor ya haya cambiado de estado
// (ni siquiera `cache: "no-store"` lo evita) — lo verifiqué aislado contra el
// backend real antes de asumir que era un bug de la app. undici es el fetch
// real de Node, sin ese bug; se lo asigna acá para TODO el archivo.
globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const NAME = `E2E Categoría ${Date.now()}`;
const NAME_EDITADA = `${NAME} (editada)`;

function testWrapper() {
  // renderHook lee los resultados fuera del render; suscribirse a todos los
  // cambios evita perder un refetch rápido antes de observar la propiedad data.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, notifyOnChangeProps: "all" } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("Categorías — CRUD de punta a punta contra el backend real (via useCrudResource)", () => {
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
    if (createdId) await apiFetch(`/categories/${createdId}`, { method: "DELETE" }).catch(() => {});
  });

  it("crear -> aparece en la lista (array plano, sin pagination) -> editar -> eliminar -> desaparece", async () => {
    const { result } = renderHook(() => useCrudResource(categoriesConfig), { wrapper: testWrapper() });

    // Espera a que el fetch INICIAL (disparado al montar el hook) termine
    // antes de seguir. Sin esto hay una carrera real: si el POST de crear
    // responde antes de que termine ese primer GET, el refetch() de abajo
    // reutiliza la promesa todavía en vuelo del fetch inicial (de-dup normal
    // de TanStack Query para la misma query key) en vez de pedir datos
    // frescos — no es un bug de la app, es una condición de carrera del test
    // que hay que evitar explícitamente.
    await waitFor(() => expect(result.current.listQuery.isSuccess).toBe(true), { timeout: 8000 });

    // 1. Crear
    result.current.createMutation.mutate({ name: NAME, description: "" });
    await waitFor(() => expect(result.current.createMutation.isSuccess).toBe(true), { timeout: 8000 });
    createdId = result.current.createMutation.data?.id;
    expect(createdId).toBeTruthy();

    // 2. La lista se invalida sola (useCrudResource, vía invalidateQueries)
    // y react-query la refetchea en segundo plano. GET /api/categories
    // devuelve un array plano: pagination debe ser null, no un objeto
    // inventado.
    await waitFor(
      () => {
        expect(result.current.listQuery.data?.pagination).toBeNull();
        expect(result.current.listQuery.data?.data.some((c) => c.id === createdId)).toBe(true);
      },
      { timeout: 8000 }
    );

    // 3. Editar
    result.current.updateMutation.mutate({ id: createdId!, values: { name: NAME_EDITADA, description: "" } });
    await waitFor(() => expect(result.current.updateMutation.isSuccess).toBe(true), { timeout: 8000 });
    await waitFor(
      () => {
        const row = result.current.listQuery.data?.data.find((c) => c.id === createdId);
        expect(row?.name).toBe(NAME_EDITADA);
      },
      { timeout: 8000 }
    );

    // 4. Eliminar
    result.current.deleteMutation.mutate(createdId!);
    await waitFor(() => expect(result.current.deleteMutation.isSuccess).toBe(true), { timeout: 8000 });
    await waitFor(
      () => {
        expect(result.current.listQuery.data?.data.some((c) => c.id === createdId)).toBe(false);
      },
      { timeout: 8000 }
    );

    createdId = undefined; // ya no hace falta que afterAll la vuelva a borrar
  }, 30000);
});
