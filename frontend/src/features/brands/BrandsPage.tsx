import { CrudTablePage } from "@/components/crud/CrudTablePage";
import { brandsConfig } from "./brands.config";

export function BrandsPage() {
  return <CrudTablePage config={brandsConfig} />;
}
