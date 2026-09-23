// E2E contra el backend real: el selector de ubicación agregado a
// OrderItemsTable (ver components/OrderItemsTable.tsx) — elegirla en el
// formulario real de creación de orden y verificar que llega como
// item.locationId en la orden creada.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import { apiFetch, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";
import { CreateDispatchOrderPage } from "./CreateDispatchOrderPage";
import { DispatchOrderDetailPage } from "./DispatchOrderDetailPage";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const USER_STORAGE_KEY = "wm_kestore_user";

const CATEGORY_NAME = `E2E DO Loc Categoría ${Date.now()}`;
const PRODUCT_SKU = `E2E-DOLOC-${Date.now()}`;
const PRODUCT_NAME = `E2E Producto Despacho Ubicación ${Date.now()}`;
const VARIANT_SKU = `E2E-DOLOC-VAR-${Date.now()}`;
const CUSTOMER_NAME = `E2E Cliente Despacho Ubicación ${Date.now()}`;
const WAREHOUSE_NAME = `E2E Bodega Despacho ${Date.now()}`;
const LOCATION_CODE = `LOC-${Date.now()}`;
const LOCATION_LABEL = `${WAREHOUSE_NAME} · ${LOCATION_CODE}`;

async function findLastByTextEventually(text: string | RegExp, timeoutMs = 8000): Promise<HTMLElement> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const matches = screen.queryAllByText(text);
    if (matches.length > 0) return matches[matches.length - 1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No apareció ningún elemento con el texto "${String(text)}" dentro de ${timeoutMs}ms`);
}

function loginAsAdmin() {
  return fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ADMIN_CREDENTIALS),
  }).then((res) => res.json() as Promise<{ token: string; user: AuthUser }>);
}

function setSession(token: string, user: AuthUser) {
  setToken(token);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

function renderCreatePage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/dispatch-orders/new"]}>
          <Routes>
            <Route path="/dispatch-orders/new" element={<CreateDispatchOrderPage />} />
            <Route path="/dispatch-orders/:id" element={<DispatchOrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("Selector de ubicación en el formulario real de creación de orden", () => {
  let categoryId: string;
  let productId: string;
  let variantId: string;
  let customerId: string;
  let warehouseId: string;
  let locationId: string;
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
      throw new Error(`Este test necesita el backend real corriendo en ${BASE} (cd backend && npm run dev).`);
    }

    const admin = await loginAsAdmin();
    setSession(admin.token, admin.user);

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

    const batch = await apiFetch<{ id: string }>("/import-batches", {
      method: "POST", body: JSON.stringify({ reference: "E2E-COST-" + VARIANT_SKU, arrivalDate: new Date().toISOString(), containerType: "LCL", containerCbm: 1 }),
    });
    await apiFetch(`/import-batches/${batch.id}/receive`, {
      method: "POST", body: JSON.stringify({ lines: [{ variantId: variant.id, quantity: 50, unitCost: 10, volumeCbm: 1, locationId }] }),
    });

    const customer = await apiFetch<{ id: string }>("/final-customers", {
      method: "POST",
      body: JSON.stringify({ fullName: CUSTOMER_NAME, idType: "CEDULA", idNumber: `${Date.now()}` }),
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    const admin = await loginAsAdmin();
    setSession(admin.token, admin.user);
    for (const orderId of createdOrderIds) {
      await apiFetch(`/dispatch-orders/${orderId}/cancel`, { method: "POST" }).catch(() => {});
    }
    await apiFetch(`/variants/${variantId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/products/${productId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/categories/${categoryId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/final-customers/${customerId}`, { method: "DELETE" }).catch(() => {});
    // La ubicación quedó con stock neto 0 (los 50 de arriba se descuentan al
    // confirmar la orden creada en el test) así que se puede eliminar sin 409.
    await apiFetch(`/locations/${locationId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/warehouses/${warehouseId}`, { method: "DELETE" }).catch(() => {});
  });

  it("elige una ubicación en la fila del ítem y llega como locationId en el ítem creado", async () => {
    const admin = await loginAsAdmin();
    setSession(admin.token, admin.user);

    renderCreatePage();

    const buyerInput = await screen.findByPlaceholderText(/buscar cliente por nombre/i);
    fireEvent.change(buyerInput, { target: { value: CUSTOMER_NAME } });
    fireEvent.click(await findLastByTextEventually(CUSTOMER_NAME));

    fireEvent.click(screen.getByRole("combobox", { name: /provincia/i }));
    fireEvent.click(await findLastByTextEventually("Pichincha"));
    fireEvent.change(screen.getByPlaceholderText("Ej: Quito"), { target: { value: "Quito" } });

    const itemSearchInput = screen.getByPlaceholderText(/buscar por sku, nombre o código de barras/i);
    fireEvent.change(itemSearchInput, { target: { value: VARIANT_SKU } });
    fireEvent.click(await findLastByTextEventually(new RegExp(VARIANT_SKU)));

    const quantityInput = await screen.findByDisplayValue("1");
    fireEvent.change(quantityInput, { target: { value: "2" } });
    const unitPriceInput = screen.getByLabelText(`Incremento sobre costo ${VARIANT_SKU}`);
    fireEvent.change(unitPriceInput, { target: { value: "50" } });

    await waitFor(() => expect(screen.getByRole("combobox", { name: `Bodega ${VARIANT_SKU}` })).toBeEnabled());
    fireEvent.click(screen.getByRole("combobox", { name: `Bodega ${VARIANT_SKU}` }));
    fireEvent.click(await findLastByTextEventually(WAREHOUSE_NAME));
    fireEvent.click(screen.getByRole("combobox", { name: `Ubicación ${VARIANT_SKU}` }));
    fireEvent.click(await findLastByTextEventually(LOCATION_LABEL));

    // happy-dom calcula incorrectamente stepMismatch para 50 con step=0.01.
    // Enviar el formulario mantiene la validación real del resolver Zod.
    fireEvent.submit(screen.getByRole("button", { name: /^crear orden$/i }).closest("form")!);

    await screen.findByRole("button", { name: /^confirmar$/i }, { timeout: 8000 });

    const list = await apiFetch<{ data: { id: string; finalCustomer: { id: string } | null }[] }>(
      "/dispatch-orders?pageSize=100"
    );
    const created = list.data.find((o) => o.finalCustomer?.id === customerId);
    expect(created).toBeTruthy();
    if (created) createdOrderIds.push(created.id);

    const detail = await apiFetch<{ items: { locationId: string | null }[] }>(`/dispatch-orders/${created!.id}`);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].locationId).toBe(locationId);

    // Confirmar la orden aplica la SALIDA con fromLocationId = la ubicación
    // elegida — el mismo contrato ya cubierto en el backend
    // (dispatchOrders.test.ts), acá se verifica que el dato llegó completo
    // desde el formulario real hasta la orden persistida.
    await apiFetch(`/dispatch-orders/${created!.id}/confirm`, { method: "POST", body: JSON.stringify({}) });
  }, 30000);
});
