import { CrudTablePage } from "@/components/crud/CrudTablePage";
import { couriersConfig } from "./couriers.config";

export function CouriersPage() {
  return <CrudTablePage config={couriersConfig} />;
}
