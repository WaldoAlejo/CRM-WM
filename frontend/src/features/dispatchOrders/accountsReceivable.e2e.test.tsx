// E2E contra el backend real: la página es ADMIN-only (OPERATOR redirige, vía
// RequireRole igual que el router real), y el listado solo trae órdenes
// CREDITO vencidas y no pagadas completas, con orderTotal ya calculado por
// el backend (computeOrderTotal) — nunca reconstruido acá.
//
// dueDate se calcula automáticamente al confirmar (dispatchDate + creditDays)
// y no hay ningún endpoint para fijarlo a mano — no existe forma de crear una
// orden "ya vencida" esperando días reales. Se manipula directo con Prisma
// (mismo mecanismo, en espíritu, que la limpieza manual de datos de prueba
// que ya se hizo en este proyecto), apuntando al backend real de desarrollo.
import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RequireRole } from "@/components/auth/RequireRole";
import { AuthProvider } from "@/context/AuthContext";
import { apiFetch, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";
import { AccountsReceivablePage } from "./AccountsReceivablePage";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const OPERATOR_CREDENTIALS = { email: "operador@kestore.com.ec", password: "Operador123!" };
const USER_STORAGE_KEY = "wm_kestore_user";

const CATEGORY_NAME = `E2E AR Categoría ${Date.now()}`;
const WHOLESALER_UNPAID = `E2E Mayorista AR Vencida ${Date.now()}`;
const WHOLESALER_PAID = `E2E Mayorista AR Pagada ${Date.now()}`;
// RUC de Ecuador: 13 dígitos numéricos exactos — Date.now() ya tiene 13
// dígitos, así que sirve tal cual como sufijo único por corrida (un RUC fijo
// colisionaría con datos de una corrida anterior que no se haya limpiado).
const RUC_UNPAID = String(Date.now());
const RUC_PAID = String(Date.now() + 1);

const BACKEND_DIR = path.resolve(process.cwd(), "../backend");

function backdateDueDate(orderId: string, daysAgo: number) {
  const scriptPath = path.join(BACKEND_DIR, `.e2e-backdate-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
  const script = `
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
prisma.dispatchOrder.update({
  where: { id: ${JSON.stringify(orderId)} },
  data: { dueDate: new Date(Date.now() - ${daysAgo} * 24 * 60 * 60 * 1000) },
}).then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
`;
  writeFileSync(scriptPath, script);
  try {
    execFileSync("node", [scriptPath], { cwd: BACKEND_DIR });
  } finally {
    unlinkSync(scriptPath);
  }
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

// CAUSA RAÍZ de la falla que arrastraba este archivo: la base de desarrollo es
// compartida y una orden CREDITO confirmada NO se puede borrar por API (los
// pedidos son historial inmutable), así que cada corrida deja una orden
// vencida más. La página lista de a 20, ordenada por dueDate ascendente — con
// más de 20 vencidas acumuladas, la orden recién creada (dueDate más reciente)
// quedaba en la página 2+ y `findByText` nunca la veía en la página 1. No es un
// bug del módulo (paginar así es su comportamiento correcto): el test tiene
// que recorrer las páginas como lo haría un usuario, no asumir que su fixture
// cae en la primera.
async function findOrderAcrossPages(orderNumber: string): Promise<HTMLElement> {
  // Los controles de paginación solo existen cuando ya llegó la respuesta.
  await screen.findByText(/en total/i, {}, { timeout: 8000 });
  for (let attempt = 0; attempt < 50; attempt++) {
    const found = screen.queryByText(orderNumber);
    if (found) return found;

    const next = screen.getByRole("button", { name: /siguiente/i }) as HTMLButtonElement;
    if (next.disabled) break;
    const currentPage = /página (\d+) de/i.exec(document.body.textContent ?? "")?.[1];
    fireEvent.click(next);
    // Mientras carga la página siguiente los controles de paginación
    // desaparecen (no hay keepPreviousData): se espera a que vuelvan, ya con
    // el número de página nuevo y sus filas.
    await waitFor(
      () => {
        const nowPage = /página (\d+) de/i.exec(document.body.textContent ?? "")?.[1];
        expect(nowPage).toBeDefined();
        expect(nowPage).not.toBe(currentPage);
      },
      { timeout: 8000 }
    );
  }
  return screen.findByText(orderNumber, {}, { timeout: 3000 });
}

// Todas las páginas de GET /accounts-receivable (pageSize máximo = 100).
async function fetchAllReceivables(): Promise<{ orderNumber: string; orderTotal: string }[]> {
  const rows: { orderNumber: string; orderTotal: string }[] = [];
  for (let page = 1; ; page++) {
    const res = await apiFetch<{
      data: { orderNumber: string; orderTotal: string }[];
      pagination: { totalPages: number };
    }>(`/accounts-receivable?pageSize=100&page=${page}`);
    rows.push(...res.data);
    if (page >= res.pagination.totalPages) return rows;
  }
}

function renderWithGate(initialPath: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route element={<RequireRole roles={["ADMIN"]} />}>
              <Route path="/accounts-receivable" element={<AccountsReceivablePage />} />
            </Route>
            <Route path="/" element={<div>Dashboard placeholder</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("Cuentas por cobrar — ADMIN-only y filtrado real, contra el backend real", () => {
  let categoryId: string;
  let productId: string;
  let variantId: string;
  let wholesalerUnpaidId: string;
  let wholesalerPaidId: string;
  let overdueUnpaidOrderNumber: string;
  let overduePaidOrderNumber: string;

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
      body: JSON.stringify({ sku: `E2E-AR-${Date.now()}`, name: "Producto AR", categoryId }),
    });
    productId = product.id;

    const variant = await apiFetch<{ id: string }>(`/products/${productId}/variants`, {
      method: "POST",
      body: JSON.stringify({ attributes: { color: "Gris" }, sku: `E2E-AR-VAR-${Date.now()}` }),
    });
    variantId = variant.id;

    await apiFetch("/inventory/adjustments", {
      method: "POST",
      body: JSON.stringify({ variantId, quantity: 50, reason: "Stock inicial para test E2E de cartera" }),
    });

    const wholesalerUnpaid = await apiFetch<{ id: string }>("/wholesalers", {
      method: "POST",
      body: JSON.stringify({ businessName: WHOLESALER_UNPAID, ruc: RUC_UNPAID }),
    });
    wholesalerUnpaidId = wholesalerUnpaid.id;

    const wholesalerPaid = await apiFetch<{ id: string }>("/wholesalers", {
      method: "POST",
      body: JSON.stringify({ businessName: WHOLESALER_PAID, ruc: RUC_PAID }),
    });
    wholesalerPaidId = wholesalerPaid.id;

    // Orden 1: CREDITO, vencida, SIN pagar — debe aparecer en la cartera.
    const order1 = await apiFetch<{ id: string; orderNumber: string }>("/dispatch-orders", {
      method: "POST",
      body: JSON.stringify({
        buyerType: "MAYORISTA",
        wholesalerId: wholesalerUnpaidId,
        shippingProvince: "Guayas",
        shippingCity: "Guayaquil",
        paymentMethod: "CREDITO",
        creditDays: 5,
        items: [{ variantId, quantity: 5, priceType: "MAYORISTA", unitPrice: 20 }],
      }),
    });
    overdueUnpaidOrderNumber = order1.orderNumber;
    await apiFetch(`/dispatch-orders/${order1.id}/confirm`, { method: "POST", body: JSON.stringify({}) });
    backdateDueDate(order1.id, 5);

    // Orden 2: CREDITO, vencida, pero PAGADA por completo — NO debe aparecer.
    const order2 = await apiFetch<{ id: string; orderNumber: string }>("/dispatch-orders", {
      method: "POST",
      body: JSON.stringify({
        buyerType: "MAYORISTA",
        wholesalerId: wholesalerPaidId,
        shippingProvince: "Guayas",
        shippingCity: "Guayaquil",
        paymentMethod: "CREDITO",
        creditDays: 5,
        items: [{ variantId, quantity: 2, priceType: "MAYORISTA", unitPrice: 20 }],
      }),
    });
    overduePaidOrderNumber = order2.orderNumber;
    await apiFetch(`/dispatch-orders/${order2.id}/confirm`, { method: "POST", body: JSON.stringify({}) });
    backdateDueDate(order2.id, 5);
    await apiFetch(`/dispatch-orders/${order2.id}/payments`, {
      method: "POST",
      body: JSON.stringify({ amount: 40, method: "transferencia" }),
    });
  }, 30000);

  afterAll(async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);
    await apiFetch(`/variants/${variantId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/products/${productId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/categories/${categoryId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/wholesalers/${wholesalerUnpaidId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/wholesalers/${wholesalerPaidId}`, { method: "DELETE" }).catch(() => {});
  });

  it("OPERATOR no puede acceder — redirige, la misma protección RequireRole que usa el router real", async () => {
    const operator = await loginAs("operator");
    setSession(operator.token, operator.user);

    renderWithGate("/accounts-receivable");

    await screen.findByText("Dashboard placeholder");
    expect(screen.queryByText(/cuentas por cobrar/i)).not.toBeInTheDocument();
  }, 15000);

  it("ADMIN ve solo la orden CREDITO vencida y no pagada, con el orderTotal calculado por el backend", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);

    renderWithGate("/accounts-receivable");

    await screen.findByText(/cuentas por cobrar/i);
    const orderLink = await findOrderAcrossPages(overdueUnpaidOrderNumber);
    const row = orderLink.closest("tr");
    if (!row) throw new Error("No se encontró la fila de la orden en la tabla");

    // orderTotal = 5 × $20 = $100, sin pagos → "Saldo: $0.00 / $100". Se
    // busca DENTRO de esta fila puntual, no en toda la página — puede haber
    // otras órdenes de prueba viejas en esta base compartida de desarrollo
    // con el mismo total por coincidencia, y esta aserción no debe depender
    // de que la base esté "limpia".
    expect(within(row).getByText(/\$0\.00 \/ \$100/)).toBeInTheDocument();

    // La orden pagada por completo (aunque vencida) no debe aparecer en NINGUNA
    // página del listado (se revisa contra la API completa, no solo la
    // página visible), y el total mostrado es el mismo que devuelve la API —
    // nunca se reconstruye sumando ítems del lado del frontend.
    const all = await fetchAllReceivables();
    expect(all.some((o) => o.orderNumber === overduePaidOrderNumber)).toBe(false);
    const apiOrder = all.find((o) => o.orderNumber === overdueUnpaidOrderNumber);
    expect(apiOrder?.orderTotal).toBe("100");
    // Timeout holgado a propósito: findOrderAcrossPages recorre las páginas de a
    // una y cada corrida deja una vencida más (no se pueden borrar), así que el
    // tiempo crece con el historial acumulado (~4 s con 80 vencidas).
  }, 90000);
});
