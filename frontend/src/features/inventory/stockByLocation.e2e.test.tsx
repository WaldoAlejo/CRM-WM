// E2E contra el backend real: la página de stock por ubicación
// (GET /inventory/stock-by-location) refleja lo que efectivamente quedó en
// el ledger — sin contador paralelo, mismo criterio que el resto del
// inventario.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, it } from "vitest";
import { apiFetch, setToken } from "@/lib/api";
import { StockByLocationPage } from "./StockByLocationPage";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };

const CATEGORY_NAME = `E2E StockLoc Categoría ${Date.now()}`;
const PRODUCT_SKU = `E2E-STOCKLOC-${Date.now()}`;
const VARIANT_SKU = `E2E-STOCKLOC-VAR-${Date.now()}`;
const WAREHOUSE_NAME = `E2E Bodega StockLoc ${Date.now()}`;
const LOCATION_CODE = `SL-${Date.now()}`;

// El nombre de la bodega aparece en la lista desplegable (Portal de Radix):
// se espera a que exista y se toma el último match.
async function waitForText(text: string, timeoutMs = 8000): Promise<HTMLElement> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const matches = screen.queryAllByText(text);
    if (matches.length > 0) return matches[matches.length - 1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No apareció "${text}" dentro de ${timeoutMs}ms`);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StockByLocationPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Stock por ubicación — página real contra el backend real", () => {
  let categoryId: string;
  let productId: string;
  let variantId: string;
  let warehouseId: string;
  let locationId: string;

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

    const category = await apiFetch<{ id: string }>("/categories", {
      method: "POST",
      body: JSON.stringify({ name: CATEGORY_NAME }),
    });
    categoryId = category.id;

    const product = await apiFetch<{ id: string }>("/products", {
      method: "POST",
      body: JSON.stringify({ sku: PRODUCT_SKU, name: "Producto stock por ubicación", categoryId }),
    });
    productId = product.id;

    const variant = await apiFetch<{ id: string }>(`/products/${productId}/variants`, {
      method: "POST",
      body: JSON.stringify({ attributes: { color: "Negro" }, sku: VARIANT_SKU }),
    });
    variantId = variant.id;

    const warehouse = await apiFetch<{ id: string }>("/warehouses", {
      method: "POST",
      body: JSON.stringify({ name: WAREHOUSE_NAME }),
    });
    warehouseId = warehouse.id;

    const location = await apiFetch<{ id: string }>(`/warehouses/${warehouseId}/locations`, {
      method: "POST",
      body: JSON.stringify({ code: LOCATION_CODE }),
    });
    locationId = location.id;

    await apiFetch("/inventory/adjustments", {
      method: "POST",
      body: JSON.stringify({ variantId, quantity: 12, reason: "E2E stock-by-location", locationId }),
    });
  });

  afterAll(async () => {
    await apiFetch("/inventory/adjustments", {
      method: "POST",
      body: JSON.stringify({ variantId, quantity: -12, reason: "E2E cleanup", locationId }),
    }).catch(() => {});
    await apiFetch(`/variants/${variantId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/products/${productId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/categories/${categoryId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/locations/${locationId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/warehouses/${warehouseId}`, { method: "DELETE" }).catch(() => {});
  });

  it("muestra la fila de la ubicación con el stock neto correcto", async () => {
    renderPage();

    // La base de desarrollo es compartida y acumula filas de otros e2e (las
    // filas del ledger nunca desaparecen, aunque su stock neto vuelva a 0);
    // la página lista de a 20 ordenada por id de ubicación, así que las
    // ubicaciones nuevas caen en la página 2+. Se filtra por la bodega propia
    // de esta corrida, como lo haría un usuario.
    fireEvent.click(await screen.findByRole("combobox", { name: /filtrar por bodega/i }));
    const options = await waitForText(WAREHOUSE_NAME);
    fireEvent.click(options);

    const table = await screen.findByRole("table");
    await within(table).findByText(VARIANT_SKU, {}, { timeout: 8000 });
    await within(table).findByText(WAREHOUSE_NAME, {}, { timeout: 8000 });
    await within(table).findByText(LOCATION_CODE, {}, { timeout: 8000 });
    await within(table).findByText("12", {}, { timeout: 8000 });
  }, 20000);
});
