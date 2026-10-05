import { hasAdminAccess } from "@/lib/roles";
import type { CrudResourceConfig } from "@/components/crud/types";
import type { Role } from "@/types/auth";
import { categoryDefaultValues, categoryFormSchema } from "./categories.schema";
import type { Category } from "./categories.types";

const isAdmin = (role: Role) => hasAdminAccess(role);

export const categoriesConfig: CrudResourceConfig<Category, typeof categoryDefaultValues> = {
  resourceKey: "categories",
  title: "Categorías",
  singular: "categoría",
  listEndpoint: "/categories",
  createEndpoint: "/categories",
  updateEndpoint: (id) => `/categories/${id}`,
  deleteEndpoint: (id) => `/categories/${id}`,
  columns: [
    { header: "Código SKU", cell: (item) => <span className="whitespace-nowrap font-mono">{item.code}</span> },
    { header: "Nombre", cell: (item) => item.name },
    { header: "Descripción", cell: (item) => item.description ?? "—" },
  ],
  formSchema: categoryFormSchema,
  formFields: [
    { name: "name", label: "Nombre", type: "text", placeholder: "Ej: Cocina" },
    { name: "code", label: "Código para SKU (2 a 4 letras)", type: "text", placeholder: "Vacío: se sugiere del nombre (Cocina → COC)" },
    { name: "description", label: "Descripción", type: "textarea", placeholder: "Opcional" },
  ],
  defaultFormValues: categoryDefaultValues,
  toFormValues: (item) => ({ name: item.name, description: item.description ?? "", code: item.code }),
  // Consultar es para cualquier autenticado; crear/editar/eliminar es
  // admin-only (mismo criterio que backend/src/modules/categories/categories.routes.ts).
  permissions: {
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
};
