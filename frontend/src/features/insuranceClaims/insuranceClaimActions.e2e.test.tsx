// E2E contra el backend real: Resolver con cliente (REPLACEMENT exitoso,
// REPLACEMENT fallando por falta de stock, REFUND exitoso) y Actualizar
// estado (con el refresco inmediato de pendingByCourier verificado, no
// solo confiado).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import { apiFetch, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";
import { InsuranceClaimsPage } from "./InsuranceClaimsPage";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const USER_STORAGE_KEY = "wm_kestore_user";

const CATEGORY_NAME = `E2E Claim Acciones Categoría ${Date.now()}`;
const CUSTOMER_NAME = `E2E Cliente Claim Acciones ${Date.now()}`;
const COURIER_NAME = `E2E Courier Claim Acciones ${Date.now()}`;

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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/insurance-claims"]}>
          <Routes>
            <Route path="/insurance-claims" element={<InsuranceClaimsPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

// Arma producto+variante+orden CONTRA_ENTREGA+confirmada+shipment
// perdido/dañado (un InsuranceClaim PENDIENTE real) — parametrizable en
// stock para poder provocar a propósito la falta de stock del test 2.
async function createOpenClaim(opts: { sku: string; quantity: number; unitPrice: number; stock: number }) {
  const { sku, quantity, unitPrice, stock } = opts;

  const category = await apiFetch<{ id: string }>("/categories", {
    method: "POST",
    // Nombre único por llamada (derivado de `sku`, ya único) — Category.name
    // es @unique, y esta función se llama varias veces en el mismo archivo.
    body: JSON.stringify({ name: `${CATEGORY_NAME} ${sku}` }),
  });
  const product = await apiFetch<{ id: string }>("/products", {
    method: "POST",
    body: JSON.stringify({ sku, name: `Producto ${sku}`, categoryId: category.id }),
  });
  const variant = await apiFetch<{ id: string }>(`/products/${product.id}/variants`, {
    method: "POST",
    body: JSON.stringify({ attributes: { color: "Negro" }, sku: `${sku}-VAR` }),
  });
  await apiFetch("/inventory/adjustments", {
    method: "POST",
    body: JSON.stringify({ variantId: variant.id, quantity: stock, reason: "Stock inicial para test E2E" }),
  });

  const customer = await apiFetch<{ id: string }>("/final-customers", {
    method: "POST",
    body: JSON.stringify({ fullName: `${CUSTOMER_NAME} ${sku}`, idType: "CEDULA", idNumber: `${Date.now()}${Math.floor(Math.random() * 1000)}` }),
  });

  let courier = await apiFetch<{ data: { id: string; name: string }[] }>(
    `/couriers?pageSize=100`
  ).then((res) => res.data.find((c) => c.name === COURIER_NAME));
  if (!courier) {
    courier = await apiFetch<{ id: string; name: string }>("/couriers", {
      method: "POST",
      body: JSON.stringify({ name: COURIER_NAME }),
    });
  }

  const order = await apiFetch<{ id: string; orderNumber: string }>("/dispatch-orders", {
    method: "POST",
    body: JSON.stringify({
      buyerType: "CLIENTE_FINAL",
      finalCustomerId: customer.id,
      shippingProvince: "Pichincha",
      shippingCity: "Quito",
      paymentMethod: "CONTRA_ENTREGA",
      items: [{ variantId: variant.id, quantity, priceType: "PVP", unitPrice }],
    }),
  });

  const confirmed = await apiFetch<{ shipment: { id: string } }>(`/dispatch-orders/${order.id}/confirm`, {
    method: "POST",
    body: JSON.stringify({ courierId: courier.id, trackingNumber: `GUIA-${sku}` }),
  });

  const lost = await apiFetch<{ insuranceClaim: { id: string } }>(
    `/shipments/${confirmed.shipment.id}/lost-or-damaged`,
    { method: "POST", body: JSON.stringify({ status: "PERDIDO" }) }
  );

  return {
    claimId: lost.insuranceClaim.id,
    orderId: order.id,
    orderNumber: order.orderNumber,
    variantId: variant.id,
    courierId: courier.id,
  };
}

describe("Reclamos de seguro — acciones (resolver con cliente, actualizar estado), contra el backend real", () => {
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
  });

  afterAll(async () => {
    const admin = await loginAsAdmin();
    setSession(admin.token, admin.user);
    // Reclamos/órdenes son registros permanentes (sin endpoint de borrado) —
    // mismo criterio ya aplicado en el resto del módulo de Despachos.
  });

  it("REPLACEMENT exitoso: muestra la orden nueva, contra entrega, y el COD esperado real", async () => {
    const admin = await loginAsAdmin();
    setSession(admin.token, admin.user);

    const { claimId, orderNumber } = await createOpenClaim({
      sku: `E2E-CA-REPL-${Date.now()}`,
      quantity: 2,
      unitPrice: 30,
      stock: 20,
    });

    renderPage();

    const orderLink = await findLastByTextEventually(orderNumber, 8000);
    const row = orderLink.closest("tr");
    if (!row) throw new Error("No se encontró la fila del reclamo");

    fireEvent.click(within(row).getByRole("button", { name: /resolver con cliente/i }));
    const dialog = await screen.findByRole("dialog");
    // REPLACEMENT ya es el default del radio — alcanza con confirmar.
    fireEvent.click(within(dialog).getByRole("button", { name: /^confirmar$/i }));

    await findLastByTextEventually(/orden de reemplazo creada/i, 8000);
    // 2 × $30 = $60, la orden original nunca se pagó.
    await findLastByTextEventually(/\$60\.00/, 8000);
    expect(within(dialog).getByRole("link")).toBeInTheDocument();

    const list = await apiFetch<{ data: { id: string; customerResolution: string }[] }>(
      "/insurance-claims?pageSize=100"
    );
    const updated = list.data.find((c) => c.id === claimId);
    expect(updated?.customerResolution).toBe("REEMPLAZO");
  }, 30000);

  it("REPLACEMENT falla por falta de stock: el mensaje específico del backend queda visible en el dialog", async () => {
    const admin = await loginAsAdmin();
    setSession(admin.token, admin.user);

    // Stock == quantity: al confirmar la orden original, el stock queda en 0
    // — la orden de reemplazo pide reservar la MISMA cantidad, y no hay.
    const { claimId, orderNumber } = await createOpenClaim({
      sku: `E2E-CA-NOSTOCK-${Date.now()}`,
      quantity: 3,
      unitPrice: 15,
      stock: 3,
    });

    renderPage();

    const orderLink = await findLastByTextEventually(orderNumber, 8000);
    const row = orderLink.closest("tr");
    if (!row) throw new Error("No se encontró la fila del reclamo");

    fireEvent.click(within(row).getByRole("button", { name: /resolver con cliente/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^confirmar$/i }));

    await waitFor(
      () => expect(within(dialog).getByText(/stock insuficiente/i)).toBeInTheDocument(),
      { timeout: 8000 }
    );
    // El dialog sigue abierto en modo formulario (no pasó a la vista de éxito).
    expect(within(dialog).getByRole("button", { name: /^confirmar$/i })).toBeInTheDocument();

    const list = await apiFetch<{ data: { id: string; customerResolution: string }[] }>(
      "/insurance-claims?pageSize=100"
    );
    const stillPending = list.data.find((c) => c.id === claimId);
    expect(stillPending?.customerResolution).toBe("PENDIENTE"); // la transacción hizo rollback
  }, 30000);

  it("REFUND exitoso: registra el pago negativo y actualiza el estado de pago de la orden original", async () => {
    const admin = await loginAsAdmin();
    setSession(admin.token, admin.user);

    const { claimId, orderNumber, orderId } = await createOpenClaim({
      sku: `E2E-CA-REFUND-${Date.now()}`,
      quantity: 1,
      unitPrice: 40,
      stock: 20,
    });

    // La orden original se paga por completo primero, para que el REFUND
    // tenga un paymentStatus real del que "retroceder".
    await apiFetch(`/dispatch-orders/${orderId}/payments`, {
      method: "POST",
      body: JSON.stringify({ amount: 40, method: "transferencia" }),
    });

    renderPage();

    const orderLink = await findLastByTextEventually(orderNumber, 8000);
    const row = orderLink.closest("tr");
    if (!row) throw new Error("No se encontró la fila del reclamo");

    fireEvent.click(within(row).getByRole("button", { name: /resolver con cliente/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByText(/^reembolso$/i));
    fireEvent.change(within(dialog).getByLabelText(/monto del reembolso/i), { target: { value: "40" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^confirmar$/i }));

    await findLastByTextEventually(/reembolso registrado/i, 8000);
    await findLastByTextEventually(/\$40/, 8000);

    const list = await apiFetch<{ data: { id: string; customerResolution: string }[] }>(
      "/insurance-claims?pageSize=100"
    );
    const updated = list.data.find((c) => c.id === claimId);
    expect(updated?.customerResolution).toBe("REEMBOLSO");

    const order = await apiFetch<{ paymentStatus: string }>(`/dispatch-orders/${orderId}`);
    expect(order.paymentStatus).not.toBe("PAGADO"); // el reembolso lo hizo retroceder
  }, 30000);

  it("actualizar estado a PAGADO refresca pendingByCourier de inmediato (sin refrescar la página)", async () => {
    const admin = await loginAsAdmin();
    setSession(admin.token, admin.user);

    const dedicatedCourierName = `E2E Courier Solo ${Date.now()}`;
    const courier = await apiFetch<{ id: string }>("/couriers", {
      method: "POST",
      body: JSON.stringify({ name: dedicatedCourierName }),
    });

    const category = await apiFetch<{ id: string }>("/categories", {
      method: "POST",
      body: JSON.stringify({ name: `E2E Claim Pagado Categoría ${Date.now()}` }),
    });
    const sku = `E2E-CA-PAGADO-${Date.now()}`;
    const product = await apiFetch<{ id: string }>("/products", {
      method: "POST",
      body: JSON.stringify({ sku, name: `Producto ${sku}`, categoryId: category.id }),
    });
    const variant = await apiFetch<{ id: string }>(`/products/${product.id}/variants`, {
      method: "POST",
      body: JSON.stringify({ attributes: { color: "Blanco" }, sku: `${sku}-VAR` }),
    });
    await apiFetch("/inventory/adjustments", {
      method: "POST",
      body: JSON.stringify({ variantId: variant.id, quantity: 20, reason: "Stock inicial para test E2E" }),
    });
    const customer = await apiFetch<{ id: string }>("/final-customers", {
      method: "POST",
      body: JSON.stringify({ fullName: `${CUSTOMER_NAME} pagado`, idType: "CEDULA", idNumber: `${Date.now()}9` }),
    });
    const order = await apiFetch<{ id: string; orderNumber: string }>("/dispatch-orders", {
      method: "POST",
      body: JSON.stringify({
        buyerType: "CLIENTE_FINAL",
        finalCustomerId: customer.id,
        shippingProvince: "Pichincha",
        shippingCity: "Quito",
        paymentMethod: "CONTRA_ENTREGA",
        items: [{ variantId: variant.id, quantity: 1, priceType: "PVP", unitPrice: 22 }],
      }),
    });
    const confirmed = await apiFetch<{ shipment: { id: string } }>(`/dispatch-orders/${order.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ courierId: courier.id, trackingNumber: "GUIA-PAGADO" }),
    });
    const lost = await apiFetch<{ insuranceClaim: { id: string } }>(
      `/shipments/${confirmed.shipment.id}/lost-or-damaged`,
      { method: "POST", body: JSON.stringify({ status: "PERDIDO" }) }
    );
    const claimId = lost.insuranceClaim.id;

    renderPage();

    // Courier dedicado (nadie más contribuye a su total en pendingByCourier).
    const orderLink = await findLastByTextEventually(order.orderNumber, 8000);
    await findLastByTextEventually(dedicatedCourierName, 8000); // aparece en pendingByCourier
    // "$22" sale tanto en la columna Monto de la fila como en la tarjeta de
    // pendingByCourier (mismo valor, un solo reclamo abierto) — al menos 2
    // coincidencias esperadas, no una sola.
    expect(screen.getAllByText("$22").length).toBeGreaterThanOrEqual(2);

    const row = orderLink.closest("tr");
    if (!row) throw new Error("No se encontró la fila del reclamo");

    fireEvent.click(within(row).getByRole("button", { name: /actualizar estado/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("combobox"));
    fireEvent.click(await findLastByTextEventually(/^pagado$/i));
    fireEvent.click(within(dialog).getByRole("button", { name: /^guardar$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 8000 });

    // Un reclamo PAGADO deja de ser "abierto" — el courier dedicado
    // desaparece del RESUMEN (pendingByCourier), sin recargar la página. El
    // reclamo en sí sigue listado en la tabla general (con su columna
    // "Courier" mostrando el mismo nombre) — por eso se escopea la
    // búsqueda al bloque de resumen, no a toda la página.
    const summaryHeading = screen.getByText("Pendiente por courier");
    const summaryCard = summaryHeading.closest("div");
    if (!summaryCard) throw new Error("No se encontró el bloque de resumen pendingByCourier");
    await waitFor(() => expect(within(summaryCard).queryByText(dedicatedCourierName)).not.toBeInTheDocument(), {
      timeout: 8000,
    });

    const claimAfter = await apiFetch<{ data: { id: string; status: string }[] }>("/insurance-claims?pageSize=100");
    const updated = claimAfter.data.find((c) => c.id === claimId);
    expect(updated?.status).toBe("PAGADO");
  }, 30000);
});
