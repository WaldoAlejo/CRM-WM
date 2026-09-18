import { CrudTablePage } from "@/components/crud/CrudTablePage";
import { warehousesConfig } from "./warehouses.config";

export function WarehousesPage() {
  return <CrudTablePage config={warehousesConfig} />;
}
