// E2E contra el backend real: la sección "Solicitud a Proveedor" es exclusiva
// de CEO — ni ADMIN ni OPERATOR la ven en el menú ni entran por URL directa —
// y el CEO puede armar la selección y descargar el PDF real generado por el
// backend. Solo se sustituye el plumbing de descarga del navegador
// (URL.createObjectURL / click del <a>), que happy-dom no implementa.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RequireRole } from "@/components/auth/RequireRole";
import { Sidebar } from "@/components/layout/Sidebar";
import { AuthProvider } from "@/context/AuthContext";
import { apiFetch, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";
import { ChinaRequestPage } from "./ChinaRequestPage";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const CREDENTIALS = {
  ceo: { email: "ceo@kestore.com.ec", password: "Ceo123456!" },
  admin: { email: "admin@kestore.com.ec", password: "Admin123!" },
  operator: { email: "operador@kestore.com.ec", password: "Operador123!" },
} as const;
type RoleKey = keyof typeof CREDENTIALS;
const USER_STORAGE_KEY = "wm_kestore_user";

const STAMP = Date.now();
const CATEGORY_NAME = `E2E China Categoría ${STAMP}`;
const PRODUCT_NAME = `Freidora E2E China ${STAMP}`;
const PRODUCT_DESCRIPTION = `Descripción única para el proveedor ${STAMP}`;
// Prefijo "000": entre las variantes con stock 0 queda SIEMPRE primera (la lista
// ordena por stock y luego SKU), así que entra aunque la base compartida tenga más.
const VARIANT_SKU = `000E2E-CHINA-${STAMP}`;

function loginAs(role: RoleKey) {
  return fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(CREDENTIALS[role]),
  }).then((res) => res.json() as Promise<{ token: string; user: AuthUser }>);
}

async function signInAs(role: RoleKey) {
  const session = await loginAs(role);
  setToken(session.token);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(session.user));
  return session;
}

function renderGate(initialPath: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route element={<RequireRole roles={["CEO"]} />}>
              <Route path="/purchasing/china-request" element={<ChinaRequestPage />} />
            </Route>
            <Route path="/" element={<div>Dashboard placeholder</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function renderSidebar() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    </AuthProvider>
  );
}

describe("Solicitud a Proveedor (China) — exclusivo de CEO, contra el backend real", () => {
  let categoryId: string;
  let productId: string;
  let variantId: string;

  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
      throw new Error(`Este test necesita el backend real corriendo en ${BASE} (cd backend && npm run dev).`);
    }
    const ceo = await loginAs("ceo");
    if (!ceo.token) {
      throw new Error('No se pudo autenticar como CEO. ¿Corriste "npx prisma db seed" en backend/?');
    }
    setToken(ceo.token);

    categoryId = (
      await apiFetch<{ id: string }>("/categories", { method: "POST", body: JSON.stringify({ name: CATEGORY_NAME }) })
    ).id;
    productId = (
      await apiFetch<{ id: string }>("/products", {
        method: "POST",
        body: JSON.stringify({
          sku: `E2E-CHINA-${STAMP}`,
          name: PRODUCT_NAME,
          description: PRODUCT_DESCRIPTION,
          categoryId,
        }),
      })
    ).id;
    // stock arranca en 0 (< 10): ya nace como "stock bajo".
    variantId = (
      await apiFetch<{ id: string }>(`/products/${productId}/variants`, {
        method: "POST",
        body: JSON.stringify({ attributes: { color: "Rojo" }, sku: VARIANT_SKU }),
      })
    ).id;
  }, 30000);

  afterAll(async () => {
    await signInAs("ceo");
    await apiFetch(`/variants/${variantId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/products/${productId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/categories/${categoryId}`, { method: "DELETE" }).catch(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("menú lateral: CEO ve 'Solicitud a Proveedor'; ADMIN y OPERATOR no (y ADMIN sí ve Usuarios, OPERATOR no)", async () => {
    await signInAs("ceo");
    const ceoView = renderSidebar();
    expect(await screen.findByText("Solicitud a Proveedor")).toBeInTheDocument();
    expect(screen.getByText("Usuarios")).toBeInTheDocument(); // CEO hereda lo de ADMIN
    ceoView.unmount();

    await signInAs("admin");
    const adminView = renderSidebar();
    await screen.findByText("Usuarios");
    expect(screen.queryByText("Solicitud a Proveedor")).not.toBeInTheDocument();
    adminView.unmount();

    await signInAs("operator");
    renderSidebar();
    await screen.findByText("Dashboard");
    expect(screen.queryByText("Solicitud a Proveedor")).not.toBeInTheDocument();
    expect(screen.queryByText("Usuarios")).not.toBeInTheDocument();
  }, 30000);

  it("URL directa: ADMIN y OPERATOR son redirigidos y nunca ven la página; CEO entra", async () => {
    for (const role of ["admin", "operator"] as const) {
      await signInAs(role);
      const view = renderGate("/purchasing/china-request");
      await screen.findByText("Dashboard placeholder");
      expect(screen.queryByRole("heading", { name: /solicitud a proveedor/i }), role).not.toBeInTheDocument();
      view.unmount();
    }

    await signInAs("ceo");
    renderGate("/purchasing/china-request");
    await screen.findByRole("heading", { name: /solicitud a proveedor/i }, { timeout: 8000 });
    expect(screen.queryByText("Dashboard placeholder")).not.toBeInTheDocument();
  }, 30000);

  it("CEO: ve el producto de stock bajo con su descripción, lo marca, indica cantidad y descarga un PDF real", async () => {
    await signInAs("ceo");

    const createObjectURL = vi.fn(() => "blob:e2e");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderGate("/purchasing/china-request");

    const label = `Seleccionar ${PRODUCT_NAME} Rojo`;
    const checkbox = await screen.findByRole("checkbox", { name: label }, { timeout: 10000 });
    expect(await screen.findByText(PRODUCT_DESCRIPTION)).toBeInTheDocument();

    // Sin selección, no se puede descargar.
    const download = screen.getByRole("button", { name: /descargar pdf/i });
    expect(download).toBeDisabled();

    fireEvent.click(checkbox);
    const quantity = await screen.findByLabelText(`Cantidad a pedir ${PRODUCT_NAME} Rojo`);
    fireEvent.change(quantity, { target: { value: "0" } }); // inválida
    expect(screen.getByRole("button", { name: /descargar pdf/i })).toBeDisabled();
    fireEvent.change(quantity, { target: { value: "25" } });

    const enabled = screen.getByRole("button", { name: /descargar pdf/i });
    expect(enabled).not.toBeDisabled();
    fireEvent.click(enabled);

    await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalled(), { timeout: 10000 });
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toMatch(/application\/pdf/);
    const head = Buffer.from(await blob.arrayBuffer()).subarray(0, 5).toString();
    expect(head).toBe("%PDF-");

    // Generar el documento no comprometió stock (sigue en 0, sin reservas).
    const summary = await apiFetch<{ data: { variantId: string; stock: number; reservedStock: number }[] }>(
      `/inventory/stock-summary?pageSize=100`
    );
    const row = summary.data.find((r) => r.variantId === variantId);
    if (row) {
      expect(row.stock).toBe(0);
      expect(row.reservedStock).toBe(0);
    }
  }, 40000);
});
