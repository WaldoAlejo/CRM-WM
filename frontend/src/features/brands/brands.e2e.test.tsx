// Prueba de punta a punta contra el BACKEND REAL (no mockeado): reproduce
// exactamente el caso que pediste verificar — borrar una Marca con productos
// activos asociados debe dar el 409 específico del backend, y ese mensaje
// exacto debe llegar al toast a través del hook real que usa la página de
// Marcas (useCrudResource), no un mensaje genérico.
//
// Precondición: backend corriendo (npm run dev en backend/) con datos de
// seed aplicados (npx prisma db seed) — usa admin@kestore.com.ec/Admin123!
// y crea su propia categoría. Si el backend no responde, el
// beforeAll falla con un mensaje explícito señalando la causa, no un timeout
// críptico de fetch.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { useCrudResource } from "@/components/crud/useCrudResource";
import { apiFetch, setToken } from "@/lib/api";
import { brandsConfig } from "./brands.config";

// Ver categories.e2e.test.tsx: happy-dom tiene un bug real en su fetch que
// repite respuestas GET cacheadas ignorando cambios de estado del backend
// (y hasta `cache: "no-store"`) — undici es el fetch real de Node, sin ese bug.
globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };

const created: { brandId?: string; productId?: string; categoryId?: string } = {};

function testWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("Brands — bloqueo 409 al borrar una marca con productos activos (E2E contra el backend real)", () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
      throw new Error(
        `Este test necesita el backend real corriendo en ${BASE} (cd backend && npm run dev), ` +
          "con datos de seed aplicados (npx prisma db seed). /health no respondió."
      );
    }

    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ADMIN_CREDENTIALS),
    });
    if (!loginRes.ok) {
      throw new Error(
        "No se pudo autenticar contra el backend real con las credenciales de seed " +
          `(${ADMIN_CREDENTIALS.email}). ¿Corriste "npx prisma db seed" en backend/?`
      );
    }
    const { token } = (await loginRes.json()) as { token: string };
    setToken(token);

    const brand = await apiFetch<{ id: string }>("/brands", {
      method: "POST",
      body: JSON.stringify({ name: `E2E Marca ${Date.now()}` }),
    });
    created.brandId = brand.id;

    const category = await apiFetch<{ id: string }>("/categories", {
      method: "POST",
      body: JSON.stringify({ name: `E2E Categoría Marca ${Date.now()}` }),
    });
    created.categoryId = category.id;

    const product = await apiFetch<{ id: string }>("/products", {
      method: "POST",
      body: JSON.stringify({
        sku: `E2E-${Date.now()}`,
        name: "Producto de prueba E2E (limpiado en afterAll)",
        categoryId: created.categoryId,
        brandId: created.brandId,
      }),
    });
    created.productId = product.id;
  }, 20000);

  afterAll(async () => {
    // Limpieza real contra el backend real: deja la base como estaba antes
    // de este test. El producto no tiene variantes (sin stock), así que su
    // soft delete no queda bloqueado.
    if (created.productId) {
      await apiFetch(`/products/${created.productId}`, { method: "DELETE" }).catch(() => {});
    }
    if (created.brandId) {
      await apiFetch(`/brands/${created.brandId}`, { method: "DELETE" }).catch(() => {});
    }
    if (created.categoryId) {
      await apiFetch(`/categories/${created.categoryId}`, { method: "DELETE" }).catch(() => {});
    }
  });

  it("DELETE /api/brands/:id devuelve 409 con el mensaje específico del backend (no un 500/error genérico)", async () => {
    await expect(apiFetch(`/brands/${created.brandId}`, { method: "DELETE" })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("productos activos asociados"),
    });
  });

  it("useCrudResource (el hook real de la página de Marcas) muestra ese mensaje EXACTO en el toast", async () => {
    const toastErrorSpy = vi.spyOn(toast, "error");

    const { result } = renderHook(() => useCrudResource(brandsConfig), { wrapper: testWrapper() });

    result.current.deleteMutation.mutate(created.brandId!);

    await waitFor(() => expect(result.current.deleteMutation.isError).toBe(true), { timeout: 8000 });

    expect(toastErrorSpy).toHaveBeenCalledWith(expect.stringContaining("productos activos asociados"));
    // Y específicamente NO el mensaje genérico de fallback (confirma que sí
    // se identificó como ApiError con el mensaje real del backend).
    expect(toastErrorSpy).not.toHaveBeenCalledWith("No se pudo eliminar. Intenta de nuevo.");

    toastErrorSpy.mockRestore();
  });
});
