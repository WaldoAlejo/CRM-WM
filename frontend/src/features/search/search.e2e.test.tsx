// E2E contra el backend real: la barra de búsqueda global navega a
// /search?q=..., la página de resultados encuentra variantes buscando por
// SKU de variante, nombre de producto y código de barras, la respuesta real
// del backend nunca trae campos de precio/costo (ni hace falta enmascararlos
// en el frontend — la query ni los pide), y cada resultado linkea al detalle
// real del producto.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import { apiFetch, setToken } from "@/lib/api";
import { ProductDetailPage } from "@/features/products/ProductDetailPage";
import { GlobalSearchBar } from "./GlobalSearchBar";
import { SearchResultsPage } from "./SearchResultsPage";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const USER_STORAGE_KEY = "wm_kestore_user";

const CATEGORY_NAME = `E2E Search Categoría ${Date.now()}`;
const PRODUCT_SKU = `E2E-SEARCH-${Date.now()}`;
const PRODUCT_NAME = `E2E Buscable Producto ${Date.now()}`;
const VARIANT_SKU = `E2E-SEARCH-VAR-${Date.now()}`;
const VARIANT_BARCODE = `${Date.now()}999`;

// Nunca se selecciona en la query del backend (search.service.ts) — si algún
// día alguien agrega un campo de precio al `select`, esta lista es la que
// hay que ampliar también, y este test lo atraparía.
const PRICE_FIELD_NAMES = [
  "costPriceCNY",
  "wholesalePrice",
  "wholesaleDiscountPct",
  "retailPrice",
  "retailDiscountPct",
];

function renderSearchResults(query: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/search?q=${encodeURIComponent(query)}`]}>
          <Routes>
            <Route path="/search" element={<SearchResultsPage />} />
            <Route path="/products/:id" element={<ProductDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function renderSearchBar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<GlobalSearchBar />} />
            <Route path="/search" element={<SearchResultsPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("Búsqueda global — GlobalSearchBar + SearchResultsPage, contra el backend real", () => {
  let categoryId: string;
  let productId: string;
  let variantId: string;

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
      throw new Error('No se pudo autenticar con las credenciales de seed. ¿Corriste "npx prisma db seed"?');
    }
    const { token, user } = (await loginRes.json()) as { token: string; user: unknown };
    setToken(token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));

    const category = await apiFetch<{ id: string }>("/categories", {
      method: "POST",
      body: JSON.stringify({ name: CATEGORY_NAME }),
    });
    categoryId = category.id;

    const product = await apiFetch<{ id: string }>("/products", {
      method: "POST",
      body: JSON.stringify({ sku: PRODUCT_SKU, name: PRODUCT_NAME, categoryId }),
    });
    productId = product.id;

    const variant = await apiFetch<{ id: string }>(`/products/${productId}/variants`, {
      method: "POST",
      body: JSON.stringify({
        attributes: { color: "Negro" },
        sku: VARIANT_SKU,
        barcode: VARIANT_BARCODE,
        retailPrice: 25.5,
        costPriceCNY: 10,
      }),
    });
    variantId = variant.id;
  });

  afterAll(async () => {
    if (variantId) await apiFetch(`/variants/${variantId}`, { method: "DELETE" }).catch(() => {});
    if (productId) await apiFetch(`/products/${productId}`, { method: "DELETE" }).catch(() => {});
    if (categoryId) await apiFetch(`/categories/${categoryId}`, { method: "DELETE" }).catch(() => {});
  });

  it("la respuesta real del backend nunca trae campos de precio/costo (la query ni los selecciona)", async () => {
    const res = await apiFetch<{ data: Record<string, unknown>[] }>(`/search?q=${VARIANT_SKU}`);
    expect(res.data.length).toBeGreaterThan(0);
    const result = res.data.find((r) => r.variantId === variantId);
    expect(result).toBeTruthy();
    for (const field of PRICE_FIELD_NAMES) {
      expect(Object.prototype.hasOwnProperty.call(result, field)).toBe(false);
    }
  });

  it.each([
    ["SKU de la variante", VARIANT_SKU],
    ["nombre del producto", PRODUCT_NAME],
    ["código de barras de la variante", VARIANT_BARCODE],
  ])("encuentra la variante buscando por %s", async (_label, query) => {
    renderSearchResults(query);
    await screen.findByText(new RegExp(PRODUCT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), {}, { timeout: 8000 });
    await screen.findByText(new RegExp(`SKU ${VARIANT_SKU}`), {}, { timeout: 8000 });
  }, 15000);

  it("no expone precio/costo en la UI de resultados (no están en el tipo ni se renderizan)", async () => {
    renderSearchResults(VARIANT_SKU);
    await screen.findByText(new RegExp(PRODUCT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), {}, { timeout: 8000 });
    expect(screen.queryByText(/\$25[.,]5/)).not.toBeInTheDocument();
    expect(screen.queryByText(/¥10/)).not.toBeInTheDocument();
  });

  it("GlobalSearchBar navega a /search con el texto escrito y ahí aparece el resultado real", async () => {
    renderSearchBar();

    const input = screen.getByPlaceholderText(/buscar por sku/i);
    fireEvent.change(input, { target: { value: VARIANT_SKU } });
    fireEvent.submit(input.closest("form")!);

    await screen.findByText(/Resultados para/, {}, { timeout: 8000 });
    await screen.findByText(
      new RegExp(PRODUCT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      {},
      { timeout: 8000 }
    );
  }, 15000);

  it("el resultado navega al detalle REAL del producto (misma ruta que usa la app)", async () => {
    renderSearchResults(VARIANT_SKU);
    const resultLink = await screen.findByText(
      new RegExp(PRODUCT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      {},
      { timeout: 8000 }
    );

    fireEvent.click(resultLink);

    // Anclado a "Editar" exacto: el producto ya tiene la variante creada en
    // beforeAll, y su fila en VariantsTable trae su propio botón "Editar
    // variante" (mismo título parcial) — /editar/i sin anclar matchea los
    // dos y explota por ambigüedad, sin que sea un bug de la app.
    await screen.findByRole("button", { name: /^editar$/i }, { timeout: 8000 });
    expect(screen.getByText(PRODUCT_NAME)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`SKU ${PRODUCT_SKU}`))).toBeInTheDocument();
  }, 15000);
});
