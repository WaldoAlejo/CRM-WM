import type { CrudResourceConfig } from "@/components/crud/types";
import type { Role } from "@/types/auth";
import { categoryDefaultValues, categoryFormSchema } from "./categories.schema";
import type { Category } from "./categories.types";

const isAdmin = (role: Role) => role === "ADMIN";

export const categoriesConfig: CrudResourceConfig<Category, typeof categoryDefaultValues> = {
  resourceKey: "categories",
  title: "Categorías",
  singular: "categoría",
  listEndpoint: "/categories",
  createEndpoint: "/categories",
  updateEndpoint: (id) => `/categories/${id}`,
  deleteEndpoint: (id) => `/categories/${id}`,
  columns: [
    { header: "Nombre", cell: (item) => item.name },
    { header: "Descripción", cell: (item) => item.description ?? "—" },
  ],
  formSchema: categoryFormSchema,
  formFields: [
    { name: "name", label: "Nombre", type: "text", placeholder: "Ej: Cocina" },
    { name: "description", label: "Descripción", type: "textarea", placeholder: "Opcional" },
  ],
  defaultFormValues: categoryDefaultValues,
  toFormValues: (item) => ({ name: item.name, description: item.description ?? "" }),
  // Consultar es para cualquier autenticado; crear/editar/eliminar es
  // admin-only (mismo criterio que backend/src/modules/categories/categories.routes.ts).
  permissions: {
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
};
