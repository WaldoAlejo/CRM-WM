// E2E contra el backend real: crear una orden (CLIENTE_FINAL/CONTADO) desde
// el formulario real (buscador de comprador + buscador de ítems, ambos
// basados en el nuevo Combobox/Popover), bloqueo de variantId duplicado al
// agregar, y visibilidad de costo/pagos por rol en el detalle.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { toast } from "sonner";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import { apiFetch, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";
import { CreateDispatchOrderPage } from "./CreateDispatchOrderPage";
import { DispatchOrderDetailPage } from "./DispatchOrderDetailPage";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const OPERATOR_CREDENTIALS = { email: "operador@kestore.com.ec", password: "Operador123!" };
const USER_STORAGE_KEY = "wm_kestore_user";

const CATEGORY_NAME = `E2E DO Categoría ${Date.now()}`;
const PRODUCT_SKU = `E2E-DO-${Date.now()}`;
const PRODUCT_NAME = `E2E Producto Despacho ${Date.now()}`;
const VARIANT_SKU = `E2E-DO-VAR-${Date.now()}`;
const CUSTOMER_NAME = `E2E Cliente Despacho ${Date.now()}`;

// Mismo problema, mismo remedio que ya se documentó en products.e2e.test.tsx
// y variants.e2e.test.tsx para Radix Select: el contenido de un Popover
// también vive en un Portal, montado/desmontado con cada apertura — un
// polling manual con temporizador real, tolerante a "no encontrado todavía"
// y a matches transitorios múltiples, evita las dos fallas sin tener que
// diagnosticar de nuevo el mismo detalle de implementación.
async function findLastByTextEventually(text: string | RegExp, timeoutMs = 8000): Promise<HTMLElement> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const matches = screen.queryAllByText(text);
    if (matches.length > 0) return matches[matches.length - 1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No apareció ningún elemento con el texto "${String(text)}" dentro de ${timeoutMs}ms`);
}

function loginAs(role: "admin" | "operator") {
  return fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(role === "admin" ? ADMIN_CREDENTIALS : OPERATOR_CREDENTIALS),
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

function renderDetailPage(id: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/dispatch-orders/${id}`]}>
          <Routes>
            <Route path="/dispatch-orders/:id" element={<DispatchOrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("Crear orden de despacho — formulario real, contra el backend real", () => {
  let categoryId: string;
  let productId: string;
  let variantId: string;
  let customerId: string;
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
      throw new Error(`Este test necesita el backend real corriendo en ${BASE} (cd backend && npm run dev).`);
    }

    const admin = await loginAs("admin");
    if (!admin.token) {
      throw new Error('No se pudo autenticar como admin. ¿Corriste "npx prisma db seed" en backend/?');
    }
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

    // Una variante recién creada arranca con stock=0 — reserveStock (dentro
    // de createDispatchOrder) rechaza con 400 cualquier cantidad > 0 si no
    // hay stock real. Se le da stock de verdad vía el mismo endpoint de
    // ajuste manual que usaría un ADMIN al recibir mercadería.
    const batch = await apiFetch<{ id: string }>("/import-batches", {
      method: "POST", body: JSON.stringify({ reference: "E2E-COST-" + VARIANT_SKU, arrivalDate: new Date().toISOString(), containerType: "LCL", containerCbm: 1 }),
    });
    const warehouse = await apiFetch<{ id: string }>("/warehouses", { method: "POST", body: JSON.stringify({ name: `E2E Recepción ${variant.id}` }) });
    const location = await apiFetch<{ id: string }>(`/warehouses/${warehouse.id}/locations`, { method: "POST", body: JSON.stringify({ code: "Recepción" }) });
    await apiFetch(`/import-batches/${batch.id}/receive`, {
      method: "POST", body: JSON.stringify({ lines: [{ locationId: location.id, variantId: variant.id, quantity: 50, unitCost: 10, volumeCbm: 1 }] }),
    });

    const customer = await apiFetch<{ id: string }>("/final-customers", {
      method: "POST",
      body: JSON.stringify({ fullName: CUSTOMER_NAME, idType: "CEDULA", idNumber: `${Date.now()}` }),
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);
    for (const orderId of createdOrderIds) {
      await apiFetch(`/dispatch-orders/${orderId}/cancel`, { method: "POST" }).catch(() => {});
    }
    await apiFetch(`/variants/${variantId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/products/${productId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/categories/${categoryId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/final-customers/${customerId}`, { method: "DELETE" }).catch(() => {});
  });

  it("crea una orden CLIENTE_FINAL/CONTADO desde el formulario real y llega al detalle", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);

    renderCreatePage();

    // Comprador: CLIENTE_FINAL ya es el default — buscar y elegir.
    const buyerInput = await screen.findByPlaceholderText(/buscar cliente por nombre/i);
    fireEvent.change(buyerInput, { target: { value: CUSTOMER_NAME } });
    fireEvent.click(await findLastByTextEventually(CUSTOMER_NAME));

    // Envío.
    fireEvent.click(screen.getByRole("combobox", { name: /provincia/i }));
    fireEvent.click(await findLastByTextEventually("Pichincha"));
    fireEvent.change(screen.getByPlaceholderText("Ej: Quito"), { target: { value: "Quito" } });

    // Ítem: buscar la variante real y agregarla. El resultado se renderiza
    // como "SKU — label" en un solo nodo de texto, así que hace falta un
    // regex (substring) — un string exacto en queryAllByText exige que
    // coincida el contenido COMPLETO del nodo, no una parte.
    const itemSearchInput = screen.getByPlaceholderText(/buscar por sku, nombre o código de barras/i);
    fireEvent.change(itemSearchInput, { target: { value: VARIANT_SKU } });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(VARIANT_SKU) }));

    // Cantidad y precio de la línea recién agregada.
    const quantityInput = await screen.findByDisplayValue("1");
    fireEvent.change(quantityInput, { target: { value: "2" } });
    const unitPriceInput = screen.getByLabelText(`Incremento sobre costo ${VARIANT_SKU}`);
    fireEvent.change(unitPriceInput, { target: { value: "50" } });

    // happy-dom calcula incorrectamente stepMismatch para 50 con step=0.01.
    // Enviar el formulario mantiene la validación real del resolver Zod.
    fireEvent.submit(screen.getByRole("button", { name: /^crear orden$/i }).closest("form")!);

    // Navega al detalle real de la orden recién creada.
    await screen.findByRole("button", { name: /^confirmar$/i }, { timeout: 8000 });
    // El nombre del comprador va combinado con el tipo y la fecha en un solo
    // nodo de texto (DispatchOrderDetailPage) — regex, no string exacto.
    await findLastByTextEventually(new RegExp(CUSTOMER_NAME), 8000);

    const list = await apiFetch<{ data: { id: string; buyerType: string; finalCustomer: { id: string } | null }[] }>(
      "/dispatch-orders?pageSize=100"
    );
    const created = list.data.find((o) => o.finalCustomer?.id === customerId);
    expect(created).toBeTruthy();
    expect(created?.buyerType).toBe("CLIENTE_FINAL");
    if (created) createdOrderIds.push(created.id);

    const detail = await apiFetch<{ items: { quantity: number; unitPrice: string }[] }>(
      `/dispatch-orders/${created!.id}`
    );
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].quantity).toBe(2);
    expect(detail.items[0].unitPrice).toBe("15");
  }, 30000);

  it("bloquea agregar el mismo variantId dos veces (toast, sin duplicar la fila)", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);

    renderCreatePage();

    const itemSearchInput = await screen.findByPlaceholderText(/buscar por sku, nombre o código de barras/i);
    fireEvent.change(itemSearchInput, { target: { value: VARIANT_SKU } });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(VARIANT_SKU) }));
    await screen.findByDisplayValue("1");

    const toastErrorSpy = vi.spyOn(toast, "error");

    fireEvent.change(itemSearchInput, { target: { value: VARIANT_SKU } });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(VARIANT_SKU) }));

    await waitFor(() =>
      expect(toastErrorSpy).toHaveBeenCalledWith(expect.stringContaining("ya está en la orden"))
    );

    // Solo debe haber UNA fila con ese SKU en la tabla (no dos).
    expect(screen.getAllByText(VARIANT_SKU)).toHaveLength(1);

    toastErrorSpy.mockRestore();
  }, 20000);

  it("ADMIN ve costos y el botón de registrar pago en el detalle; OPERATOR no ve ninguno de los dos", async () => {
    // Crea una orden mínima directo por API — el foco es la visibilidad en
    // el DETALLE, no repetir el flujo de creación.
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);
    const order = await apiFetch<{ id: string }>("/dispatch-orders", {
      method: "POST",
      body: JSON.stringify({
        buyerType: "CLIENTE_FINAL",
        finalCustomerId: customerId,
        shippingProvince: "Pichincha",
        shippingCity: "Quito",
        paymentMethod: "CONTADO",
        items: [{ variantId, quantity: 1, priceType: "PVP", unitPrice: 10 }],
      }),
    });
    createdOrderIds.push(order.id);

    const adminRender = renderDetailPage(order.id);
    await screen.findByText(/costo unitario/i, {}, { timeout: 8000 });
    expect(screen.getByRole("button", { name: /registrar pago/i })).toBeInTheDocument();
    adminRender.unmount();

    const operator = await loginAs("operator");
    setSession(operator.token, operator.user);
    renderDetailPage(order.id);
    await screen.findByText(/pagos/i, {}, { timeout: 8000 });
    expect(screen.queryByText(/costo unitario/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /registrar pago/i })).not.toBeInTheDocument();
  }, 20000);
});
