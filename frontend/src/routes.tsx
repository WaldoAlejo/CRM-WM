import { createBrowserRouter, Navigate } from "react-router-dom";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { RequireRole } from "@/components/auth/RequireRole";
import { AppLayout } from "@/components/layout/AppLayout";
import { BrandsPage } from "@/features/brands/BrandsPage";
import { CategoriesPage } from "@/features/categories/CategoriesPage";
import { ConsignmentDetailPage } from "@/features/consignment/ConsignmentDetailPage";
import { ConsignmentPage } from "@/features/consignment/ConsignmentPage";
import { CreateConsignmentLotPage } from "@/features/consignment/CreateConsignmentLotPage";
import { CouriersPage } from "@/features/couriers/CouriersPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { AccountsReceivablePage } from "@/features/dispatchOrders/AccountsReceivablePage";
import { CreateDispatchOrderPage } from "@/features/dispatchOrders/CreateDispatchOrderPage";
import { DispatchOrderDetailPage } from "@/features/dispatchOrders/DispatchOrderDetailPage";
import { DispatchOrdersPage } from "@/features/dispatchOrders/DispatchOrdersPage";
import { FinalCustomersPage } from "@/features/finalCustomers/FinalCustomersPage";
import { ChinaRequestPage } from "@/features/purchasing/ChinaRequestPage";
import { CreateImportBatchPage } from "@/features/importBatches/CreateImportBatchPage";
import { ImportBatchDetailPage } from "@/features/importBatches/ImportBatchDetailPage";
import { ImportBatchesPage } from "@/features/importBatches/ImportBatchesPage";
import { ReceiveStockPage } from "@/features/importBatches/ReceiveStockPage";
import { InsuranceClaimsPage } from "@/features/insuranceClaims/InsuranceClaimsPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { LocationsPage } from "@/features/locations/LocationsPage";
import { QuarantinePage } from "@/features/quarantine/QuarantinePage";
import { ProductDetailPage } from "@/features/products/ProductDetailPage";
import { ProductsPage } from "@/features/products/ProductsPage";
import { ProfitabilityDashboardPage } from "@/features/reports/ProfitabilityDashboardPage";
import { ProfitabilityDetailPage } from "@/features/reports/ProfitabilityDetailPage";
import { SearchResultsPage } from "@/features/search/SearchResultsPage";
import { SuppliersPage } from "@/features/suppliers/SuppliersPage";
import { LowStockPage } from "@/features/inventory/LowStockPage";
import { StockByLocationPage } from "@/features/inventory/StockByLocationPage";
import { UsersPage } from "@/features/users/UsersPage";
import { WarehousesPage } from "@/features/warehouses/WarehousesPage";
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
          { path: "inventory", element: <StockByLocationPage /> },
          { path: "inventory/low-stock", element: <LowStockPage /> },
          { path: "import-batches", element: <ImportBatchesPage /> },
          { path: "import-batches/new", element: <CreateImportBatchPage /> },
          { path: "import-batches/:id", element: <ImportBatchDetailPage /> },
          { path: "import-batches/:id/receive", element: <ReceiveStockPage /> },
          { path: "dispatch-orders", element: <DispatchOrdersPage /> },
          { path: "dispatch-orders/new", element: <CreateDispatchOrderPage /> },
          { path: "dispatch-orders/:id", element: <DispatchOrderDetailPage /> },
          { path: "catalog/categories", element: <CategoriesPage /> },
          { path: "catalog/brands", element: <BrandsPage /> },
          { path: "catalog/suppliers", element: <SuppliersPage /> },
          { path: "catalog/couriers", element: <CouriersPage /> },
          { path: "catalog/warehouses", element: <WarehousesPage /> },
          { path: "catalog/warehouses/:warehouseId/locations", element: <LocationsPage /> },
          { path: "catalog/wholesalers", element: <WholesalersPage /> },
          { path: "catalog/final-customers", element: <FinalCustomersPage /> },
          {
            element: <RequireRole roles={["ADMIN"]} />,
            children: [
              { path: "accounts-receivable", element: <AccountsReceivablePage /> },
              { path: "consignment", element: <ConsignmentPage /> },
              { path: "consignment/new", element: <CreateConsignmentLotPage /> },
              { path: "consignment/:id", element: <ConsignmentDetailPage /> },
              { path: "insurance-claims", element: <InsuranceClaimsPage /> },
              { path: "reports", element: <ProfitabilityDashboardPage /> },
              { path: "reports/profitability", element: <ProfitabilityDetailPage /> },
              { path: "admin/users", element: <UsersPage /> },
            ],
          },
          {
            // Cuarentena/Validación: OPERATOR y superiores (todos los roles autenticados).
            // Espejo de requireRole(OPERATOR) de /api/quarantine; nunca muestra precios.
            element: <RequireRole roles={["OPERATOR"]} />,
            children: [{ path: "quarantine", element: <QuarantinePage /> }],
          },
          {
            // Exclusivo de CEO (ADMIN NO pasa): espejo de requireRole(Role.CEO) del backend.
            element: <RequireRole roles={["CEO"]} />,
            children: [{ path: "purchasing/china-request", element: <ChinaRequestPage /> }],
          },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
