import { CrudTablePage } from "@/components/crud/CrudTablePage";
import { suppliersConfig } from "./suppliers.config";

export function SuppliersPage() {
  return <CrudTablePage config={suppliersConfig} />;
}
