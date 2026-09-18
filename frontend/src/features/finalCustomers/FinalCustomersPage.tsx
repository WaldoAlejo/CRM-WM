import { CrudTablePage } from "@/components/crud/CrudTablePage";
import { finalCustomersConfig } from "./finalCustomers.config";

export function FinalCustomersPage() {
  return <CrudTablePage config={finalCustomersConfig} />;
}
