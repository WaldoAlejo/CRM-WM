// E2E contra el backend real: semáforo de cuentas por cobrar en sus TRES lugares
// (listado, detalle y Dashboard). Una cuenta de cada color: pendiente (>7 días),
// por vencer (≤7 días), vencida CON abono parcial (debe seguir roja, no
// amarilla) y completada (pagada por completo).
//
// dueDate no se puede fijar por API (se calcula al confirmar), así que la
// vencida se prepara con Prisma directo — igual que accountsReceivable.e2e.
import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { beforeAll, describe, expect, it } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { apiFetch, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";
import { AccountsReceivablePage } from "./AccountsReceivablePage";
import { DispatchOrderDetailPage } from "./DispatchOrderDetailPage";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN = { email: "admin@kestore.com.ec", password: "Admin123!" };
const USER_STORAGE_KEY = "wm_kestore_user";
const STAMP = Date.now();
const BACKEND_DIR = path.resolve(process.cwd(), "../backend");

function backdateDueDate(orderId: string, daysAgo: number) {
  const scriptPath = path.join(BACKEND_DIR, `.e2e-backdate-tl-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
  writeFileSync(
    scriptPath,
    `
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
prisma.dispatchOrder.update({
  where: { id: ${JSON.stringify(orderId)} },
  data: { dueDate: new Date(Date.now() - ${daysAgo} * 24 * 60 * 60 * 1000) },
}).then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
`
  );
  try {
    execFileSync("node", [scriptPath], { cwd: BACKEND_DIR });
  } finally {
    unlinkSync(scriptPath);
  }
}

async function signInAsAdmin() {
  const session = (await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ADMIN),
  }).then((r) => r.json())) as { token: string; user: AuthUser };
  setToken(session.token);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(session.user));
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/accounts-receivable" element={<AccountsReceivablePage />} />
            <Route path="/dispatch-orders/:id" element={<DispatchOrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

// La base de desarrollo es compartida y estas listas se acumulan y paginan de a
// 20: se recorren las páginas como lo haría un usuario (ver accountsReceivable.e2e).
async function findRowAcrossPages(orderNumber: string): Promise<HTMLTableRowElement> {
  await screen.findByText(/en total/i, {}, { timeout: 20000 });
  for (let attempt = 0; attempt < 50; attempt++) {
    const found = screen.queryByText(orderNumber);
    if (found) return found.closest("tr") as HTMLTableRowElement;
    const next = screen.getByRole("button", { name: /siguiente/i }) as HTMLButtonElement;
    if (next.disabled) break;
    const currentPage = /página (\d+) de/i.exec(document.body.textContent ?? "")?.[1];
    fireEvent.click(next);
    await waitFor(
      () => {
        const nowPage = /página (\d+) de/i.exec(document.body.textContent ?? "")?.[1];
        expect(nowPage).toBeDefined();
        expect(nowPage).not.toBe(currentPage);
      },
      { timeout: 8000 }
    );
  }
  return (await screen.findByText(orderNumber, {}, { timeout: 3000 })).closest("tr") as HTMLTableRowElement;
}

interface Created {
  id: string;
  orderNumber: string;
}

describe("Semáforo de cuentas por cobrar — de punta a punta contra el backend real", () => {
  let pending: Created;
  let dueSoon: Created;
  let overduePartial: Created;
  let completed: Created;

  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
      throw new Error(`Este test necesita el backend real corriendo en ${BASE} (cd backend && npm run dev).`);
    }
    await signInAsAdmin();

    const category = await apiFetch<{ id: string }>("/categories", {
      method: "POST",
      body: JSON.stringify({ name: `E2E TL Cat ${STAMP}` }),
    });
    const product = await apiFetch<{ id: string }>("/products", {
      method: "POST",
      body: JSON.stringify({ sku: `E2E-TL-${STAMP}`, name: "Producto TL", categoryId: category.id }),
    });
    const variant = await apiFetch<{ id: string }>(`/products/${product.id}/variants`, {
      method: "POST",
      body: JSON.stringify({ attributes: { color: "Rojo" }, sku: `E2E-TL-VAR-${STAMP}` }),
    });
    await apiFetch("/inventory/adjustments", {
      method: "POST",
      body: JSON.stringify({ variantId: variant.id, quantity: 40, reason: "Stock inicial para test E2E de semáforo" }),
    });
    const wholesaler = await apiFetch<{ id: string }>("/wholesalers", {
      method: "POST",
      body: JSON.stringify({ businessName: `E2E Mayorista TL ${STAMP}`, ruc: String(STAMP) }),
    });

    // Cada orden: 1 × $20 a crédito; creditDays define el vencimiento al confirmar.
    async function creditOrder(creditDays: number): Promise<Created> {
      const order = await apiFetch<Created>("/dispatch-orders", {
        method: "POST",
        body: JSON.stringify({
          buyerType: "MAYORISTA",
          wholesalerId: wholesaler.id,
          shippingProvince: "Guayas",
          shippingCity: "Guayaquil",
          paymentMethod: "CREDITO",
          creditDays,
          items: [{ variantId: variant.id, quantity: 1, priceType: "MAYORISTA", unitPrice: 20 }],
        }),
      });
      await apiFetch(`/dispatch-orders/${order.id}/confirm`, { method: "POST", body: JSON.stringify({}) });
      return order;
    }
    const pay = (id: string, amount: number) =>
      apiFetch(`/dispatch-orders/${id}/payments`, { method: "POST", body: JSON.stringify({ amount, method: "efectivo" }) });

    pending = await creditOrder(30); // > 7 días
    dueSoon = await creditOrder(3); // 0–7 días
    overduePartial = await creditOrder(5);
    backdateDueDate(overduePartial.id, 2); // ya venció…
    await pay(overduePartial.id, 8); // …con un abono parcial
    completed = await creditOrder(30);
    await pay(completed.id, 20); // pagada por completo
  }, 90000);

  it("listado por defecto (vencidas): la cuenta vencida con abono parcial es ROJA (badge + fila), no amarilla", async () => {
    await signInAsAdmin();
    renderAt("/accounts-receivable");

    const row = await findRowAcrossPages(overduePartial.orderNumber);
    const badge = row.querySelector('[data-collection-status]');
    expect(badge?.getAttribute("data-collection-status")).toBe("VENCIDO");
    expect(badge?.textContent).toBe("Vencido");
    expect(row.className).toMatch(/bg-red-50/); // la fila entera, no solo el texto
    expect(row.textContent).toMatch(/Pago parcial/);
    expect(row.textContent).toMatch(/Vencida hace 2 días/);
    expect(row.textContent).not.toMatch(/Por vencer/);
  }, 90000);

  it("filtros: por vencer (ámbar), pendiente (gris/azul) y completado (verde) — cada fila con su badge y su tinte", async () => {
    await signInAsAdmin();

    const cases: [string, Created, string, string, RegExp | null][] = [
      ["POR_VENCER", dueSoon, "Por vencer", "bg-amber-50", /Vence en 3 días/],
      ["PENDIENTE", pending, "Pendiente", "shadow-\\[inset_4px_0_0_0_#94a3b8\\]", /Vence en 30 días/],
      ["COMPLETADO", completed, "Completado", "bg-green-50", null],
    ];
    for (const [status, order, label, rowClass, deadline] of cases) {
      const view = renderAt(`/accounts-receivable?status=${status}`);
      const row = await findRowAcrossPages(order.orderNumber);
      const badge = row.querySelector("[data-collection-status]");
      expect(badge?.getAttribute("data-collection-status"), status).toBe(status);
      expect(badge?.textContent, status).toBe(label);
      expect(row.className, status).toMatch(new RegExp(rowClass));
      if (deadline) expect(row.textContent, status).toMatch(deadline);
      view.unmount();
    }
  }, 120000);

  it("detalle: cada cuenta muestra su semáforo junto al estado de pago", async () => {
    await signInAsAdmin();
    const expected: [Created, string][] = [
      [overduePartial, "Vencido"],
      [dueSoon, "Por vencer"],
      [pending, "Pendiente"],
      [completed, "Completado"],
    ];
    for (const [order, label] of expected) {
      const view = renderAt(`/dispatch-orders/${order.id}`);
      await screen.findByRole("heading", { name: order.orderNumber }, { timeout: 20000 });
      const badge = document.querySelector("[data-collection-status]");
      expect(badge?.textContent, order.orderNumber).toBe(label);
      view.unmount();
    }
  }, 90000);

  it("Dashboard: el bloque de cartera muestra el semáforo (vencidas / por vencer / pendientes) con enlace al listado filtrado", async () => {
    await signInAsAdmin();
    renderAt("/");

    await screen.findByRole("region", { name: /semáforo de cartera/i }, { timeout: 20000 });
    for (const [status, plural] of [
      ["VENCIDO", "Vencidas"],
      ["POR_VENCER", "Por vencer"],
      ["PENDIENTE", "Pendientes"],
    ] as const) {
      const tile = document.querySelector(`a[data-collection-status="${status}"]`) as HTMLAnchorElement;
      expect(tile, status).not.toBeNull();
      expect(tile.textContent).toContain(plural);
      expect(tile.getAttribute("href")).toBe(`/accounts-receivable?status=${status}`);
      // Al menos las cuentas de este test (la base es compartida y puede haber más).
      const count = Number(tile.querySelector("p")?.textContent);
      expect(count, status).toBeGreaterThanOrEqual(1);
    }
    // Lo de siempre sigue ahí.
    expect(screen.getByText("Cuentas por cobrar vencidas")).toBeInTheDocument();
  }, 60000);
});
