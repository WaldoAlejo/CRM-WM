import { CrudTablePage } from "@/components/crud/CrudTablePage";
import { categoriesConfig } from "./categories.config";

export function CategoriesPage() {
  return <CrudTablePage config={categoriesConfig} />;
}
