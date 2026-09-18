import type { CrudResourceConfig } from "@/components/crud/types";
import type { Role } from "@/types/auth";
import { supplierDefaultValues, supplierFormSchema } from "./suppliers.schema";
import type { Supplier } from "./suppliers.types";

const isAdmin = (role: Role) => role === "ADMIN";

export const suppliersConfig: CrudResourceConfig<Supplier, typeof supplierDefaultValues> = {
  resourceKey: "suppliers",
  title: "Proveedores",
  singular: "proveedor",
  listEndpoint: "/suppliers",
  createEndpoint: "/suppliers",
  updateEndpoint: (id) => `/suppliers/${id}`,
  // Sin bloqueo por ImportBatch dependientes (backend/suppliers.service.ts):
  // son historial inmutable, un proveedor soft-deleted no les afecta.
  deleteEndpoint: (id) => `/suppliers/${id}`,
  columns: [
    { header: "Nombre", cell: (item) => item.name },
    { header: "Contacto", cell: (item) => item.contactInfo ?? "—" },
  ],
  formSchema: supplierFormSchema,
  formFields: [
    { name: "name", label: "Nombre", type: "text", placeholder: "Ej: Proveedor Shenzhen" },
    { name: "contactInfo", label: "Información de contacto", type: "textarea", placeholder: "Teléfono, WeChat, email..." },
  ],
  defaultFormValues: supplierDefaultValues,
  toFormValues: (item) => ({ name: item.name, contactInfo: item.contactInfo ?? "" }),
  permissions: {
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
};
