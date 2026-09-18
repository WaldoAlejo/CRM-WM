import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

interface CategoryWithSubcategories {
  id: string;
  name: string;
  subcategories: { id: string; name: string }[];
}

// GET /api/categories ya incluye `subcategories` anidadas por categoría (ver
// backend/src/modules/categories/categories.service.ts::listCategories) —
// alcanza un solo fetch para armar la cascada categoría → subcategoría,
// tanto en el formulario de producto como en los filtros del listado.
export function useCategoryOptions() {
  return useQuery({
    queryKey: ["categories", "options"],
    queryFn: () => apiFetch<CategoryWithSubcategories[]>("/categories"),
  });
}
