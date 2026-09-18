import { createBrowserRouter, Navigate } from "react-router-dom";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { RequireRole } from "@/components/auth/RequireRole";
import { AppLayout } from "@/components/layout/AppLayout";
import { ComingSoonPage } from "@/components/layout/ComingSoonPage";
import { BrandsPage } from "@/features/brands/BrandsPage";
import { CategoriesPage } from "@/features/categories/CategoriesPage";
import { CouriersPage } from "@/features/couriers/CouriersPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { AccountsReceivablePage } from "@/features/dispatchOrders/AccountsReceivablePage";
import { CreateDispatchOrderPage } from "@/features/dispatchOrders/CreateDispatchOrderPage";
import { DispatchOrderDetailPage } from "@/features/dispatchOrders/DispatchOrderDetailPage";
import { DispatchOrdersPage } from "@/features/dispatchOrders/DispatchOrdersPage";
import { FinalCustomersPage } from "@/features/finalCustomers/FinalCustomersPage";
import { InsuranceClaimsPage } from "@/features/insuranceClaims/InsuranceClaimsPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { ProductDetailPage } from "@/features/products/ProductDetailPage";
import { ProductsPage } from "@/features/products/ProductsPage";
import { ProfitabilityDashboardPage } from "@/features/reports/ProfitabilityDashboardPage";
import { ProfitabilityDetailPage } from "@/features/reports/ProfitabilityDetailPage";
import { SearchResultsPage } from "@/features/search/SearchResultsPage";
import { SuppliersPage } from "@/features/suppliers/SuppliersPage";
import { WholesalersPage } from "@/features/wholesalers/WholesalersPage";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: "products", element: <ProductsPage /> },
          { path: "products/:id", element: <ProductDetailPage /> },
          { path: "search", element: <SearchResultsPage /> },
          { path: "inventory", element: <ComingSoonPage title="Inventario" /> },
          { path: "dispatch-orders", element: <DispatchOrdersPage /> },
          { path: "dispatch-orders/new", element: <CreateDispatchOrderPage /> },
          { path: "dispatch-orders/:id", element: <DispatchOrderDetailPage /> },
          { path: "catalog/categories", element: <CategoriesPage /> },
          { path: "catalog/brands", element: <BrandsPage /> },
          { path: "catalog/suppliers", element: <SuppliersPage /> },
          { path: "catalog/couriers", element: <CouriersPage /> },
          { path: "catalog/wholesalers", element: <WholesalersPage /> },
          { path: "catalog/final-customers", element: <FinalCustomersPage /> },
          {
            element: <RequireRole roles={["ADMIN"]} />,
            children: [
              { path: "accounts-receivable", element: <AccountsReceivablePage /> },
              { path: "insurance-claims", element: <InsuranceClaimsPage /> },
              { path: "reports", element: <ProfitabilityDashboardPage /> },
              { path: "reports/profitability", element: <ProfitabilityDetailPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
