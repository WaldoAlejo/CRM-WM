// E2E contra el backend real: comprobante fotográfico de pago. ADMIN/CEO lo ven
// (por un endpoint autenticado, no una URL pública); OPERATOR ve el pago pero ni
// la columna ni el botón; y el ledger es append-only: no hay forma de editar ni
// borrar un pago o su comprobante.
//
// La subida usa el FormData de undici directamente (con el File del entorno): el FormData de
// happy-dom no es serializable por el fetch de undici (solo un tema del
// entorno de test; en el navegador real apiFetch envía el FormData nativo).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fetch as undiciFetch, FormData as UndiciFormData } from "undici";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import { apiFetch, getToken, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";
import { DispatchOrderDetailPage } from "./DispatchOrderDetailPage";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const CREDENTIALS = {
  admin: { email: "admin@kestore.com.ec", password: "Admin123!" },
  operator: { email: "operador@kestore.com.ec", password: "Operador123!" },
} as const;
type RoleKey = keyof typeof CREDENTIALS;
const USER_STORAGE_KEY = "wm_kestore_user";

const STAMP = Date.now();
// PNG mínimo válido (1x1).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

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
}

function renderDetail(orderId: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/dispatch-orders/${orderId}`]}>
          <Routes>
            <Route path="/dispatch-orders/:id" element={<DispatchOrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("Comprobante de pago — de punta a punta contra el backend real", () => {
  let orderId: string;
  let proofPaymentId: string;

  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
      throw new Error(`Este test necesita el backend real corriendo en ${BASE} (cd backend && npm run dev).`);
    }
    await signInAs("admin");

    const category = await apiFetch<{ id: string }>("/categories", {
      method: "POST",
      body: JSON.stringify({ name: `E2E Proof Cat ${STAMP}` }),
    });
    const product = await apiFetch<{ id: string }>("/products", {
      method: "POST",
      body: JSON.stringify({ sku: `E2E-PROOF-${STAMP}`, name: "Producto Proof", categoryId: category.id }),
    });
    const variant = await apiFetch<{ id: string }>(`/products/${product.id}/variants`, {
      method: "POST",
      body: JSON.stringify({ attributes: { color: "Gris" }, sku: `E2E-PROOF-VAR-${STAMP}` }),
    });
    await apiFetch("/inventory/adjustments", {
      method: "POST",
      body: JSON.stringify({ variantId: variant.id, quantity: 20, reason: "Stock inicial para test E2E de comprobante" }),
    });
    const wholesaler = await apiFetch<{ id: string }>("/wholesalers", {
      method: "POST",
      body: JSON.stringify({ businessName: `E2E Mayorista Proof ${STAMP}`, ruc: String(STAMP), defaultCreditDays: 30 }),
    });
    const order = await apiFetch<{ id: string }>("/dispatch-orders", {
      method: "POST",
      body: JSON.stringify({
        buyerType: "MAYORISTA",
        wholesalerId: wholesaler.id,
        shippingProvince: "Guayas",
        shippingCity: "Guayaquil",
        paymentMethod: "CREDITO",
        items: [{ variantId: variant.id, quantity: 5, priceType: "MAYORISTA", unitPrice: 20 }],
      }),
    });
    orderId = order.id;
    await apiFetch(`/dispatch-orders/${orderId}/confirm`, { method: "POST", body: JSON.stringify({}) });

    // Pago CON foto (multipart real, con el FormData de undici) y pago SIN foto (JSON).
    const form = new UndiciFormData();
    form.append("amount", "40");
    form.append("method", "transferencia");
    form.append("notes", "Con comprobante");
    form.append("proof", new File([PNG], "comprobante.png", { type: "image/png" }));
    const withProof = await fetch(`${BASE}/api/dispatch-orders/${orderId}/payments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken()}` },
      body: form as unknown as BodyInit,
    });
    expect(withProof.status).toBe(201);
    await apiFetch(`/dispatch-orders/${orderId}/payments`, {
      method: "POST",
      body: JSON.stringify({ amount: 10, method: "efectivo", notes: "Sin comprobante" }),
    });

    const detail = await apiFetch<{ payments: { id: string; hasProof?: boolean }[] }>(`/dispatch-orders/${orderId}`);
    proofPaymentId = detail.payments.find((p) => p.hasProof)!.id;
  }, 60000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ADMIN: ve la columna Comprobante, el botón solo en el pago que tiene foto, y la imagen se abre desde el endpoint autenticado", async () => {
    await signInAs("admin");
    const created: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((obj) => {
      created.push(obj as Blob);
      return "blob:comprobante-test";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    renderDetail(orderId);
    await screen.findByRole("columnheader", { name: /comprobante/i }, { timeout: 8000 });
    // Un solo botón: el pago sin foto muestra "—".
    const buttons = await screen.findAllByRole("button", { name: /ver comprobante/i });
    expect(buttons).toHaveLength(1);

    fireEvent.click(buttons[0]);
    const dialog = await screen.findByRole("dialog");
    const img = await within(dialog).findByRole("img", { name: /comprobante de pago/i }, { timeout: 8000 });
    expect(img.getAttribute("src")).toBe("blob:comprobante-test");
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe("image/png");
    expect(created[0].size).toBe(PNG.length);
    // Solo lectura: ninguna acción para cambiarlo o borrarlo.
    expect(within(dialog).queryByRole("button", { name: /editar|eliminar|borrar|reemplazar/i })).not.toBeInTheDocument();
  }, 60000);

  it("OPERATOR: ve los pagos (monto y método) pero NI la columna NI el botón del comprobante", async () => {
    await signInAs("operator");
    renderDetail(orderId);

    await screen.findByText("Con comprobante", {}, { timeout: 8000 });
    expect(screen.getByText("$40")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /comprobante/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ver comprobante/i })).not.toBeInTheDocument();

    // Y el backend lo cierra igual (no depende del ocultamiento del front).
    const res = await fetch(`${BASE}/api/dispatch-orders/${orderId}/payments/${proofPaymentId}/proof`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    expect(res.status).toBe(403);
  }, 60000);

  it("registrar pago: el formulario acepta una foto opcional y rechaza en el cliente tipos/tamaños inválidos", async () => {
    await signInAs("admin");
    renderDetail(orderId);
    fireEvent.click(await screen.findByRole("button", { name: /registrar pago/i }, { timeout: 8000 }));
    const dialog = await screen.findByRole("dialog");

    const input = within(dialog).getByLabelText(/comprobante \(foto\)/i) as HTMLInputElement;
    const submit = within(dialog).getByRole("button", { name: /^registrar pago$/i });

    fireEvent.change(input, { target: { files: [new File(["hola"], "notas.txt", { type: "text/plain" })] } });
    expect(await within(dialog).findByText(/formato no permitido/i)).toBeInTheDocument();
    expect(submit).toBeDisabled();

    fireEvent.change(input, { target: { files: [new File([new Uint8Array(6 * 1024 * 1024)], "grande.png", { type: "image/png" })] } });
    expect(await within(dialog).findByText(/supera los 5 MB/i)).toBeInTheDocument();
    expect(submit).toBeDisabled();

    fireEvent.change(input, { target: { files: [new File([PNG], "ok.png", { type: "image/png" })] } });
    await waitFor(() => expect(within(dialog).queryByText(/formato no permitido|supera los 5 MB/i)).not.toBeInTheDocument());
    expect(submit).toBeEnabled();
    // El aviso de inmutabilidad es visible ANTES de guardar.
    expect(within(dialog).getByText(/no se puede cambiar ni eliminar/i)).toBeInTheDocument();
  }, 60000);

  it("ledger append-only: no hay acciones de editar/borrar en la UI, y por API editar o borrar un pago (o su foto) falla", async () => {
    await signInAs("admin");
    renderDetail(orderId);
    await screen.findByText("Con comprobante", {}, { timeout: 8000 });
    expect(screen.queryByRole("button", { name: /editar|eliminar|borrar/i })).not.toBeInTheDocument();

    const url = `${BASE}/api/dispatch-orders/${orderId}/payments/${proofPaymentId}`;
    const headers = { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" };
    for (const method of ["PATCH", "PUT", "DELETE"]) {
      const res = await fetch(url, { method, headers, body: method === "DELETE" ? undefined : JSON.stringify({ amount: 1, method: "x" }) });
      expect(res.status, method).toBe(405);
    }
    const detail = await apiFetch<{ payments: { id: string; amount: string; hasProof?: boolean }[] }>(`/dispatch-orders/${orderId}`);
    const payment = detail.payments.find((p) => p.id === proofPaymentId)!;
    expect(Number(payment.amount)).toBe(40);
    expect(payment.hasProof).toBe(true);
  }, 60000);
});
