import { hasAdminAccess } from "@/lib/roles";
import type { CrudResourceConfig } from "@/components/crud/types";
import type { Role } from "@/types/auth";
import { brandDefaultValues, brandFormSchema } from "./brands.schema";
import type { Brand } from "./brands.types";

const isAdmin = (role: Role) => hasAdminAccess(role);

export const brandsConfig: CrudResourceConfig<Brand, typeof brandDefaultValues> = {
  resourceKey: "brands",
  title: "Marcas",
  singular: "marca",
  listEndpoint: "/brands",
  createEndpoint: "/brands",
  updateEndpoint: (id) => `/brands/${id}`,
  // DELETE puede volver 409 si la marca tiene productos activos asociados
  // (backend/src/modules/brands/brands.service.ts::softDeleteBrand) — el
  // toast de error de useCrudResource es lo que muestra ese mensaje.
  deleteEndpoint: (id) => `/brands/${id}`,
  columns: [
    { header: "Nombre", cell: (item) => item.name },
    { header: "Descripción", cell: (item) => item.description ?? "—" },
  ],
  formSchema: brandFormSchema,
  formFields: [
    { name: "name", label: "Nombre", type: "text", placeholder: "Ej: WM Home" },
    { name: "description", label: "Descripción", type: "textarea", placeholder: "Opcional" },
  ],
  defaultFormValues: brandDefaultValues,
  toFormValues: (item) => ({ name: item.name, description: item.description ?? "" }),
  permissions: {
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
};
