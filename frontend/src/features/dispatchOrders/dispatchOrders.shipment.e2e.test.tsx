// E2E contra el backend real: las 3 acciones sobre un shipment CONTRA_ENTREGA
// (entregado/rechazado/perdido-dañado), cada una verificando su efecto real
// documentado en shipments.service.ts — y que los 3 botones solo aparecen
// mientras el envío sigue EN_TRANSITO, desapareciendo después de cualquiera
// de las 3 acciones.
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
const USER_STORAGE_KEY = "wm_kestore_user";

const CATEGORY_NAME = `E2E Shipment Categoría ${Date.now()}`;
const CUSTOMER_NAME = `E2E Cliente Shipment ${Date.now()}`;
const COURIER_NAME = `E2E Courier Shipment ${Date.now()}`;

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

describe("Acciones sobre el shipment — entregado/rechazado/perdido-dañado, contra el backend real", () => {
  let categoryId: string;
  let customerId: string;
  let courierId: string;
  const createdProductIds: string[] = [];
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
      throw new Error(`Este test necesita el backend real corriendo en ${BASE} (cd backend && npm run dev).`);
    }
    const admin = await loginAsAdmin();
    if (!admin.token) {
      throw new Error('No se pudo autenticar como admin. ¿Corriste "npx prisma db seed" en backend/?');
    }
    setSession(admin.token, admin.user);

    const category = await apiFetch<{ id: string }>("/categories", {
      method: "POST",
      body: JSON.stringify({ name: CATEGORY_NAME }),
    });
    categoryId = category.id;

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
    const admin = await loginAsAdmin();
    setSession(admin.token, admin.user);
    for (const orderId of createdOrderIds) {
      await apiFetch(`/dispatch-orders/${orderId}/cancel`, { method: "POST" }).catch(() => {});
    }
    for (const productId of createdProductIds) {
      await apiFetch(`/products/${productId}`, { method: "DELETE" }).catch(() => {});
    }
    await apiFetch(`/categories/${categoryId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/final-customers/${customerId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/couriers/${courierId}`, { method: "DELETE" }).catch(() => {});
  });

  // Cada acción solo se puede aplicar UNA vez sobre un shipment EN_TRANSITO
  // (el backend rechaza con 409 fuera de ese estado) — cada test arma su
  // propio producto/variante/orden en lugar de compartir uno.
  async function setUpShipmentInTransit(quantity: number, unitPrice: number, sku: string) {
    const product = await apiFetch<{ id: string }>("/products", {
      method: "POST",
      body: JSON.stringify({ sku, name: `Producto ${sku}`, categoryId }),
    });
    createdProductIds.push(product.id);

    const variant = await apiFetch<{ id: string }>(`/products/${product.id}/variants`, {
      method: "POST",
      body: JSON.stringify({ attributes: { color: "Verde" }, sku: `${sku}-VAR` }),
    });

    await apiFetch("/inventory/adjustments", {
      method: "POST",
      body: JSON.stringify({ variantId: variant.id, quantity: 20, reason: "Stock inicial para test E2E" }),
    });

    const order = await apiFetch<{ id: string }>("/dispatch-orders", {
      method: "POST",
      body: JSON.stringify({
        buyerType: "CLIENTE_FINAL",
        finalCustomerId: customerId,
        shippingProvince: "Pichincha",
        shippingCity: "Quito",
        paymentMethod: "CONTRA_ENTREGA",
        items: [{ variantId: variant.id, quantity, priceType: "PVP", unitPrice }],
      }),
    });
    createdOrderIds.push(order.id);

    const confirmed = await apiFetch<{ shipment: { id: string } }>(`/dispatch-orders/${order.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ courierId, trackingNumber: "GUIA-SETUP" }),
    });

    return { orderId: order.id, productId: product.id, variantId: variant.id, shipmentId: confirmed.shipment.id };
  }

  it("marca el envío como entregado: crea el Payment automático y oculta los 3 botones", async () => {
    const admin = await loginAsAdmin();
    setSession(admin.token, admin.user);

    const { orderId, productId, variantId } = await setUpShipmentInTransit(3, 10, `E2E-SHIP-DELIVER-${Date.now()}`);
    const stockAfterConfirm = await getVariantStock(productId, variantId);

    renderDetailPage(orderId);
    await findLastByTextEventually(/en tránsito/i, 8000);
    expect(screen.getByRole("button", { name: /marcar entregado/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /marcar rechazado/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /marcar perdido\/dañado/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /marcar entregado/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/monto cobrado/i), { target: { value: "30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^marcar entregado$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 8000 });
    await findLastByTextEventually("Entregado", 8000);

    expect(screen.queryByRole("button", { name: /marcar entregado/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /marcar rechazado/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /marcar perdido\/dañado/i })).not.toBeInTheDocument();

    const order = await apiFetch<{
      shipment: { status: string; codAmountCollected: string | null };
      payments: { amount: string; method: string }[];
    }>(`/dispatch-orders/${orderId}`);
    expect(order.shipment?.status).toBe("ENTREGADO");
    expect(order.shipment?.codAmountCollected).toBe("30");
    const courierPayment = order.payments.find((p) => p.method === "cobro courier");
    expect(courierPayment).toBeTruthy();
    expect(courierPayment?.amount).toBe("30");

    // deliver no aplica ningún InventoryMovement extra: el stock ya bajó al
    // confirmar (SALIDA) y una entrega exitosa no lo modifica más.
    const stockAfterDeliver = await getVariantStock(productId, variantId);
    expect(stockAfterDeliver).toBe(stockAfterConfirm);
  }, 30000);

  it("marca el envío como rechazado: el stock vuelve a subir (DEVOLUCION) y oculta los 3 botones", async () => {
    const admin = await loginAsAdmin();
    setSession(admin.token, admin.user);

    const { orderId, productId, variantId } = await setUpShipmentInTransit(4, 10, `E2E-SHIP-REJECT-${Date.now()}`);
    const stockAfterConfirm = await getVariantStock(productId, variantId);

    renderDetailPage(orderId);
    await findLastByTextEventually(/en tránsito/i, 8000);

    fireEvent.click(screen.getByRole("button", { name: /marcar rechazado/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/motivo de rechazo/i), {
      target: { value: "Cliente no estaba en el domicilio" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^marcar rechazado$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 8000 });
    await findLastByTextEventually("Rechazado", 8000);

    expect(screen.queryByRole("button", { name: /marcar entregado/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /marcar rechazado/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /marcar perdido\/dañado/i })).not.toBeInTheDocument();

    const order = await apiFetch<{ shipment: { status: string; rejectionReason: string | null } }>(
      `/dispatch-orders/${orderId}`
    );
    expect(order.shipment?.status).toBe("RECHAZADO");
    expect(order.shipment?.rejectionReason).toBe("Cliente no estaba en el domicilio");

    // DEVOLUCION: la mercadería vuelve físicamente a bodega, +quantity.
    const stockAfterReject = await getVariantStock(productId, variantId);
    expect(stockAfterReject).toBe(stockAfterConfirm + 4);
  }, 30000);

  it("marca el envío como perdido/dañado: NO crea movimiento de inventario y genera el InsuranceClaim", async () => {
    const admin = await loginAsAdmin();
    setSession(admin.token, admin.user);

    const { orderId, productId, variantId } = await setUpShipmentInTransit(2, 15, `E2E-SHIP-LOST-${Date.now()}`);
    const stockAfterConfirm = await getVariantStock(productId, variantId);

    renderDetailPage(orderId);
    await findLastByTextEventually(/en tránsito/i, 8000);

    fireEvent.click(screen.getByRole("button", { name: /marcar perdido\/dañado/i }));
    const dialog = await screen.findByRole("dialog");
    // PERDIDO ya es el default del selector — alcanza con confirmar.
    fireEvent.click(within(dialog).getByRole("button", { name: /^confirmar$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 8000 });
    await findLastByTextEventually("Perdido", 8000);

    expect(screen.queryByRole("button", { name: /marcar entregado/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /marcar rechazado/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /marcar perdido\/dañado/i })).not.toBeInTheDocument();

    await findLastByTextEventually(/reclamo de seguro generado/i, 8000);

    const order = await apiFetch<{
      shipment: { status: string; claim: { status: string; claimAmount: string } | null };
    }>(`/dispatch-orders/${orderId}`);
    expect(order.shipment?.status).toBe("PERDIDO");
    expect(order.shipment?.claim).toBeTruthy();
    expect(order.shipment?.claim?.status).toBe("PENDIENTE");
    // claimAmount = Σ(unitPrice × quantity) = 15 × 2 = 30.
    expect(order.shipment?.claim?.claimAmount).toBe("30");

    // Diseño acordado: el SALIDA original ya sacó el stock de forma
    // definitiva — perdido/dañado NO debe restarlo una segunda vez.
    const stockAfterLost = await getVariantStock(productId, variantId);
    expect(stockAfterLost).toBe(stockAfterConfirm);
  }, 30000);
});
