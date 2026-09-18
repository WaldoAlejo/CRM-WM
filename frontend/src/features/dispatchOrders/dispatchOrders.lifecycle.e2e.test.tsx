// E2E contra el backend real: confirmar una orden CONTADO (descuenta stock),
// confirmar una orden CONTRA_ENTREGA (el dialog exige courier y crea el
// shipment EN_TRANSITO), cancelar una orden PENDIENTE (libera el stock
// reservado), y registrar un pago (ADMIN-only, la UI se actualiza tras la
// mutación).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import { apiFetch, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";
import { DispatchOrderDetailPage } from "./DispatchOrderDetailPage";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const OPERATOR_CREDENTIALS = { email: "operador@kestore.com.ec", password: "Operador123!" };
const USER_STORAGE_KEY = "wm_kestore_user";

const CATEGORY_NAME = `E2E Lifecycle Categoría ${Date.now()}`;
const PRODUCT_SKU = `E2E-LC-${Date.now()}`;
const PRODUCT_NAME = `E2E Producto Lifecycle ${Date.now()}`;
const VARIANT_SKU = `E2E-LC-VAR-${Date.now()}`;
const CUSTOMER_NAME = `E2E Cliente Lifecycle ${Date.now()}`;
const COURIER_NAME = `E2E Courier Lifecycle ${Date.now()}`;

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

async function getVariantStock(productId: string, variantId: string): Promise<number> {
  const detail = await apiFetch<{ variants: { id: string; stock: number }[] }>(`/products/${productId}`);
  const variant = detail.variants.find((v) => v.id === variantId);
  if (!variant) throw new Error("Variante no encontrada al leer stock");
  return variant.stock;
}

async function createOrder(payload: Record<string, unknown>): Promise<string> {
  const order = await apiFetch<{ id: string }>("/dispatch-orders", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return order.id;
}

describe("Ciclo de vida de una orden — confirmar/cancelar/pagos, contra el backend real", () => {
  let categoryId: string;
  let productId: string;
  let variantId: string;
  let customerId: string;
  let courierId: string;
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
      body: JSON.stringify({ attributes: { color: "Azul" }, sku: VARIANT_SKU }),
    });
    variantId = variant.id;

    await apiFetch("/inventory/adjustments", {
      method: "POST",
      body: JSON.stringify({ variantId, quantity: 30, reason: "Stock inicial para test E2E de ciclo de vida" }),
    });

    const customer = await apiFetch<{ id: string }>("/final-customers", {
      method: "POST",
      body: JSON.stringify({ fullName: CUSTOMER_NAME, idType: "CEDULA", idNumber: `${Date.now()}` }),
    });
    customerId = customer.id;

    const courier = await apiFetch<{ id: string }>("/couriers", {
      method: "POST",
      body: JSON.stringify({ name: COURIER_NAME }),
    });
    courierId = courier.id;
  });

  afterAll(async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);
    // Cancelar solo tiene efecto sobre órdenes PENDIENTE — las que este
    // archivo confirma quedan como registro permanente a propósito (no
    // existe endpoint para borrar una orden), así que el producto/categoría
    // de este test NO se pueden borrar por API una vez confirmadas. Se limpia
    // lo que sí se puede; el resto se limpia después con un script directo.
    for (const orderId of createdOrderIds) {
      await apiFetch(`/dispatch-orders/${orderId}/cancel`, { method: "POST" }).catch(() => {});
    }
    await apiFetch(`/variants/${variantId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/products/${productId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/categories/${categoryId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/final-customers/${customerId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/couriers/${courierId}`, { method: "DELETE" }).catch(() => {});
  });

  it("confirma una orden CONTADO: pasa a DESPACHADO y el stock se descuenta", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);

    const stockBefore = await getVariantStock(productId, variantId);

    const orderId = await createOrder({
      buyerType: "CLIENTE_FINAL",
      finalCustomerId: customerId,
      shippingProvince: "Pichincha",
      shippingCity: "Quito",
      paymentMethod: "CONTADO",
      items: [{ variantId, quantity: 4, priceType: "PVP", unitPrice: 10 }],
    });
    createdOrderIds.push(orderId);

    renderDetailPage(orderId);

    fireEvent.click(await screen.findByRole("button", { name: /^confirmar$/i }, { timeout: 8000 }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^confirmar$/i }));

    await findLastByTextEventually("Despachado", 8000);

    const order = await apiFetch<{ status: string }>(`/dispatch-orders/${orderId}`);
    expect(order.status).toBe("DESPACHADO");

    const stockAfter = await getVariantStock(productId, variantId);
    expect(stockAfter).toBe(stockBefore - 4);
  }, 30000);

  it("confirma una orden CONTRA_ENTREGA: el dialog exige courier y crea el shipment EN_TRANSITO", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);

    const orderId = await createOrder({
      buyerType: "CLIENTE_FINAL",
      finalCustomerId: customerId,
      shippingProvince: "Pichincha",
      shippingCity: "Quito",
      paymentMethod: "CONTRA_ENTREGA",
      items: [{ variantId, quantity: 2, priceType: "PVP", unitPrice: 12 }],
    });
    createdOrderIds.push(orderId);

    renderDetailPage(orderId);

    fireEvent.click(await screen.findByRole("button", { name: /^confirmar$/i }, { timeout: 8000 }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/contra entrega/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("combobox", { name: /^courier$/i }));
    fireEvent.click(await findLastByTextEventually(COURIER_NAME));
    fireEvent.change(within(dialog).getByLabelText(/número de guía/i), { target: { value: "GUIA-123" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^confirmar$/i }));

    await findLastByTextEventually(/en tránsito/i, 8000);

    const order = await apiFetch<{
      status: string;
      shipment: { status: string; courier: { id: string }; trackingNumber: string | null } | null;
    }>(`/dispatch-orders/${orderId}`);
    expect(order.status).toBe("DESPACHADO");
    expect(order.shipment).toBeTruthy();
    expect(order.shipment?.status).toBe("EN_TRANSITO");
    expect(order.shipment?.courier.id).toBe(courierId);
    expect(order.shipment?.trackingNumber).toBe("GUIA-123");
  }, 30000);

  it("cancela una orden PENDIENTE: libera el stock reservado (disponible antes/después)", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);

    const searchBefore = await apiFetch<{ data: { availableStock: number }[] }>(`/search?q=${VARIANT_SKU}`);
    const availableBefore = searchBefore.data[0].availableStock;

    const orderId = await createOrder({
      buyerType: "CLIENTE_FINAL",
      finalCustomerId: customerId,
      shippingProvince: "Pichincha",
      shippingCity: "Quito",
      paymentMethod: "CONTADO",
      items: [{ variantId, quantity: 3, priceType: "PVP", unitPrice: 10 }],
    });

    const searchAfterCreate = await apiFetch<{ data: { availableStock: number }[] }>(`/search?q=${VARIANT_SKU}`);
    expect(searchAfterCreate.data[0].availableStock).toBe(availableBefore - 3);

    renderDetailPage(orderId);

    fireEvent.click(await screen.findByRole("button", { name: /^cancelar$/i }, { timeout: 8000 }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cancelar orden/i }));

    await findLastByTextEventually("Cancelado", 8000);

    const order = await apiFetch<{ status: string }>(`/dispatch-orders/${orderId}`);
    expect(order.status).toBe("CANCELADO");

    const searchAfterCancel = await apiFetch<{ data: { availableStock: number }[] }>(`/search?q=${VARIANT_SKU}`);
    expect(searchAfterCancel.data[0].availableStock).toBe(availableBefore);
  }, 30000);

  it("registrar pago es ADMIN-only: OPERATOR no ve el formulario, ADMIN sí y la UI se actualiza tras registrar", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);

    const orderId = await createOrder({
      buyerType: "CLIENTE_FINAL",
      finalCustomerId: customerId,
      shippingProvince: "Pichincha",
      shippingCity: "Quito",
      paymentMethod: "CONTADO",
      items: [{ variantId, quantity: 2, priceType: "PVP", unitPrice: 50 }],
    });
    createdOrderIds.push(orderId);
    await apiFetch(`/dispatch-orders/${orderId}/confirm`, { method: "POST", body: JSON.stringify({}) });

    const operator = await loginAs("operator");
    setSession(operator.token, operator.user);
    const operatorRender = renderDetailPage(orderId);
    await screen.findByText(/^pagos$/i, {}, { timeout: 8000 });
    expect(screen.queryByRole("button", { name: /registrar pago/i })).not.toBeInTheDocument();
    operatorRender.unmount();

    setSession(admin.token, admin.user);
    renderDetailPage(orderId);
    await screen.findByText(/pagado: \$0.00 \/ \$100/i, {}, { timeout: 8000 });

    fireEvent.click(screen.getByRole("button", { name: /registrar pago/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^monto$/i), { target: { value: "40" } });
    fireEvent.change(within(dialog).getByLabelText(/^método$/i), { target: { value: "efectivo" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^registrar pago$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 8000 });
    // amountPaid serializa como "40" (Prisma Decimal sin ceros de más a la
    // derecha), no "40.00" — mismo criterio ya documentado en el proyecto.
    await findLastByTextEventually(/pagado: \$40 \/ \$100/i, 8000);
    await findLastByTextEventually(/pago parcial/i, 8000);
    expect(screen.getByText("efectivo")).toBeInTheDocument();

    const order = await apiFetch<{ amountPaid: string; paymentStatus: string }>(`/dispatch-orders/${orderId}`);
    expect(order.amountPaid).toBe("40");
    expect(order.paymentStatus).toBe("PARCIAL");
  }, 30000);
});
