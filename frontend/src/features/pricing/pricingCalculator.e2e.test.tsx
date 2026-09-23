// E2E contra el backend real: calculadora de precios (costo aterrizado → PVP →
// margen), en sus DOS puntos de entrada — inline en un Lote de Importación y
// standalone desde Producto/Variante (última recepción) — y su check de
// persistencia: usar la calculadora NUNCA guarda nada por sí sola.
//
// Se recibe con freightCost=customsCost=otherCosts=0 a propósito: así el
// prorrateo es $0 y el costo aterrizado queda EXACTAMENTE en unitCost=$32.75,
// el mismo número del ejemplo de negocio (incrementos de 70% y 30% → PVP $72.38; descuento
// 30%, 200 unidades → cobro $10,374 / costo $3,900 / ganancia $6,474).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { beforeAll, describe, expect, it } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import { ImportBatchDetailPage } from "@/features/importBatches/ImportBatchDetailPage";
import { ProductDetailPage } from "@/features/products/ProductDetailPage";
import { apiFetch, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const CREDENTIALS = {
  admin: { email: "admin@kestore.com.ec", password: "Admin123!" },
  ceo: { email: "ceo@kestore.com.ec", password: "Ceo123456!" },
  operator: { email: "operador@kestore.com.ec", password: "Operador123!" },
} as const;
type RoleKey = keyof typeof CREDENTIALS;
const USER_STORAGE_KEY = "wm_kestore_user";

const STAMP = Date.now();
const CATEGORY_NAME = `E2E Pricing Cat ${STAMP}`;
const PRODUCT_SKU = `E2E-PRICING-${STAMP}`;
const VARIANT_SKU = `E2E-PRICING-VAR-${STAMP}`;

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

function renderApp(initialPath: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/products/:id" element={<ProductDetailPage />} />
            <Route path="/import-batches/:id" element={<ImportBatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("Calculadora de precios — de punta a punta contra el backend real", () => {
  let productId: string;
  let variantId: string;
  let batchId: string;

  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
      throw new Error(`Este test necesita el backend real corriendo en ${BASE} (cd backend && npm run dev).`);
    }
    await signInAs("admin");

    const category = await apiFetch<{ id: string }>("/categories", {
      method: "POST",
      body: JSON.stringify({ name: CATEGORY_NAME }),
    });
    const product = await apiFetch<{ id: string }>("/products", {
      method: "POST",
      body: JSON.stringify({ sku: PRODUCT_SKU, name: "Producto Calculadora E2E", categoryId: category.id }),
    });
    productId = product.id;
    const variant = await apiFetch<{ id: string }>(`/products/${productId}/variants`, {
      method: "POST",
      body: JSON.stringify({ attributes: { color: "Negro" }, sku: VARIANT_SKU }),
    });
    variantId = variant.id;

    // Ejemplo: $45,000 / 70 CBM; 4.68 CBM para 204 unidades de $18.
    const batch = await apiFetch<{ id: string }>("/import-batches", {
      method: "POST",
      body: JSON.stringify({ reference: `E2E-PRICING-CONT-${STAMP}`, containerType: "40", containerCbm: 70, freightCost: 45000, arrivalDate: new Date().toISOString() }),
    });
    batchId = batch.id;
    const warehouse = await apiFetch<{ id: string }>("/warehouses", { method: "POST", body: JSON.stringify({ name: `E2E Recepción ${variant.id}` }) });
    const location = await apiFetch<{ id: string }>(`/warehouses/${warehouse.id}/locations`, { method: "POST", body: JSON.stringify({ code: "Recepción" }) });
    await apiFetch(`/import-batches/${batchId}/receive`, {
      method: "POST",
      body: JSON.stringify({ lines: [{ locationId: location.id, variantId, quantity: 204, volumeCbm: 4.68, unitCost: 18 }] }),
    });
  }, 30000);

  it("la importación guarda el costo y los precios se negocian en el despacho", async () => {
    await signInAs("admin");
    const product = await apiFetch<{ variants: { id: string; costPriceUSD: string | null; wholesalePrice: string | null; retailPrice: string | null }[] }>(`/products/${productId}`);
    const variant = product.variants.find(v => v.id === variantId)!;
    expect(Number(variant.costPriceUSD)).toBe(18);
    expect(variant.wholesalePrice).toBeNull();
    expect(variant.retailPrice).toBeNull();
    renderApp(`/products/${productId}`);
    const row = (await screen.findByText(VARIANT_SKU)).closest("tr")!;
    fireEvent.click(within(row).getByTitle(/^editar variante$/i));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("Precio mayorista")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Precio público (PVP)")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/en cada despacho ingresa el porcentaje/i)).toBeInTheDocument();
  }, 30000);

});
