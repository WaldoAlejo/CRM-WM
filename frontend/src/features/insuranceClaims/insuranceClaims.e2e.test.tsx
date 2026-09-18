// E2E contra el backend real: la página es ADMIN-only (OPERATOR redirige, vía
// RequireRole igual que el router real), el listado real trae el reclamo
// creado por un shipment PERDIDO/DANADO, pendingByCourier suma el monto
// correcto, el filtro shipmentId aísla un único reclamo (el link directo
// desde la orden), y el badge "Vencido" aparece cuando corresponde.
//
// expectedResolutionDate se calcula automáticamente al marcar el shipment
// como perdido/dañado (claimDate + 20 días) y no hay ningún endpoint para
// fijarlo a mano — se manipula directo con Prisma (mismo mecanismo que ya
// se usó en accountsReceivable.e2e.test.tsx para dueDate), apuntando al
// backend real de desarrollo.
import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RequireRole } from "@/components/auth/RequireRole";
import { AuthProvider } from "@/context/AuthContext";
import { apiFetch, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";
import { InsuranceClaimsPage } from "./InsuranceClaimsPage";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const OPERATOR_CREDENTIALS = { email: "operador@kestore.com.ec", password: "Operador123!" };
const USER_STORAGE_KEY = "wm_kestore_user";

const CATEGORY_NAME = `E2E Claims Categoría ${Date.now()}`;
const CUSTOMER_NAME = `E2E Cliente Claims ${Date.now()}`;
const COURIER_NAME = `E2E Courier Claims ${Date.now()}`;

const BACKEND_DIR = path.resolve(process.cwd(), "../backend");

function backdateExpectedResolution(claimId: string, daysAgo: number) {
  const scriptPath = path.join(BACKEND_DIR, `.e2e-backdate-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
  const script = `
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
prisma.insuranceClaim.update({
  where: { id: ${JSON.stringify(claimId)} },
  data: { expectedResolutionDate: new Date(Date.now() - ${daysAgo} * 24 * 60 * 60 * 1000) },
}).then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
`;
  writeFileSync(scriptPath, script);
  try {
    execFileSync("node", [scriptPath], { cwd: BACKEND_DIR });
  } finally {
    unlinkSync(scriptPath);
  }
}

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

function renderWithGate(initialPath: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route element={<RequireRole roles={["ADMIN"]} />}>
              <Route path="/insurance-claims" element={<InsuranceClaimsPage />} />
            </Route>
            <Route path="/" element={<div>Dashboard placeholder</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("Reclamos de seguro — listado real, contra el backend real", () => {
  let categoryId: string;
  let productId: string;
  let variantId: string;
  let customerId: string;
  let courierId: string;
  let shipmentId: string;
  let claimId: string;
  let orderNumber: string;

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
      body: JSON.stringify({ sku: `E2E-CLAIM-${Date.now()}`, name: "Producto reclamo", categoryId }),
    });
    productId = product.id;

    const variant = await apiFetch<{ id: string }>(`/products/${productId}/variants`, {
      method: "POST",
      body: JSON.stringify({ attributes: { color: "Rojo" }, sku: `E2E-CLAIM-VAR-${Date.now()}` }),
    });
    variantId = variant.id;

    await apiFetch("/inventory/adjustments", {
      method: "POST",
      body: JSON.stringify({ variantId, quantity: 20, reason: "Stock inicial para test E2E de reclamos" }),
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

    const order = await apiFetch<{ id: string; orderNumber: string }>("/dispatch-orders", {
      method: "POST",
      body: JSON.stringify({
        buyerType: "CLIENTE_FINAL",
        finalCustomerId: customerId,
        shippingProvince: "Pichincha",
        shippingCity: "Quito",
        paymentMethod: "CONTRA_ENTREGA",
        items: [{ variantId, quantity: 2, priceType: "PVP", unitPrice: 25 }],
      }),
    });
    orderNumber = order.orderNumber;

    const confirmed = await apiFetch<{ shipment: { id: string } }>(`/dispatch-orders/${order.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ courierId, trackingNumber: "GUIA-CLAIM" }),
    });
    shipmentId = confirmed.shipment.id;

    const lost = await apiFetch<{ insuranceClaim: { id: string } }>(`/shipments/${shipmentId}/lost-or-damaged`, {
      method: "POST",
      body: JSON.stringify({ status: "PERDIDO" }),
    });
    claimId = lost.insuranceClaim.id;
  }, 30000);

  afterAll(async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);
    // El reclamo/orden/shipment son registros permanentes (sin endpoint de
    // borrado) — no se intenta limpiar por API, mismo criterio ya aplicado
    // en el resto del módulo de Despachos.
  });

  it("OPERATOR no puede acceder — redirige, la misma protección RequireRole que usa el router real", async () => {
    const operator = await loginAs("operator");
    setSession(operator.token, operator.user);

    renderWithGate("/insurance-claims");

    await screen.findByText("Dashboard placeholder");
    expect(screen.queryByText(/reclamos de seguro/i)).not.toBeInTheDocument();
  }, 15000);

  it("ADMIN ve el reclamo real en la lista, con el monto correcto en pendingByCourier", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);

    renderWithGate("/insurance-claims");

    await screen.findByText(/reclamos de seguro/i);
    const orderLink = await findLastByTextEventually(orderNumber, 8000);

    // claimAmount = Σ(unitPrice × quantity) = 25 × 2 = 50. "$50" puede
    // aparecer también en el resumen pendingByCourier (mismo monto, un solo
    // reclamo abierto para este courier) — se busca DENTRO de la fila
    // puntual, no en toda la página.
    const row = orderLink.closest("tr");
    if (!row) throw new Error("No se encontró la fila de la orden en la tabla");
    expect(within(row).getByText("$50")).toBeInTheDocument();

    await findLastByTextEventually(COURIER_NAME, 8000);
    const pendingSummaryAmounts = screen.getAllByText("$50");
    expect(pendingSummaryAmounts.length).toBeGreaterThanOrEqual(2); // fila + resumen
  }, 15000);

  it("el filtro shipmentId aísla el único reclamo de esa orden (link directo desde ShipmentSection)", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);

    const filtered = await apiFetch<{ data: { id: string }[] }>(`/insurance-claims?shipmentId=${shipmentId}`);
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0].id).toBe(claimId);
  });

  it("muestra el badge Vencido cuando expectedResolutionDate ya pasó y el reclamo sigue abierto", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);

    backdateExpectedResolution(claimId, 5);

    renderWithGate("/insurance-claims");

    await findLastByTextEventually(orderNumber, 8000);
    await findLastByTextEventually("Vencido", 8000);
  }, 15000);
});
