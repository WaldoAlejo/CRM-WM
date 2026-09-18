import { hasAdminAccess } from "@/lib/roles";
import type { CrudResourceConfig } from "@/components/crud/types";
import type { Role } from "@/types/auth";
import { wholesalerDefaultValues, wholesalerFormSchema } from "./wholesalers.schema";
import type { Wholesaler } from "./wholesalers.types";

const isAdmin = (role: Role) => hasAdminAccess(role);

// Ya no es un caso especial "sin editar/eliminar": el backend ahora expone
// PATCH/DELETE /api/wholesalers/:id (admin-only), así que este config trae
// updateEndpoint/deleteEndpoint como los demás módulos.
//
// La CREACIÓN sigue sin pasar por CrudFormDialog/el patrón genérico —
// WholesalerFormDialog tiene el botón "Validar RUC", que no es algo que el
// patrón genérico deba saber modelar para los otros 5 módulos. La EDICIÓN sí
// reusa CrudFormDialog tal cual (editar un mayorista no necesita re-validar
// el RUC contra el proveedor externo — ver wholesalers.service.ts:
// updateWholesaler nunca vuelve a consultarlo), así que WholesalersPage
// arma sus acciones de fila (✏️/🗑️) igual que CrudTablePage, sin duplicar esa
// lógica.
export const wholesalersConfig: CrudResourceConfig<Wholesaler, typeof wholesalerDefaultValues> = {
  resourceKey: "wholesalers",
  title: "Mayoristas",
  singular: "mayorista",
  listEndpoint: "/wholesalers",
  createEndpoint: "/wholesalers",
  updateEndpoint: (id) => `/wholesalers/${id}`,
  deleteEndpoint: (id) => `/wholesalers/${id}`,
  columns: [
    { header: "Razón social", cell: (item) => item.businessName },
    { header: "RUC", cell: (item) => item.ruc },
    { header: "Cupo de crédito", cell: (item) => (item.creditLimit ? `$${item.creditLimit}` : "—") },
  ],
  formSchema: wholesalerFormSchema,
  formFields: [
    { name: "ruc", label: "RUC", type: "text", placeholder: "1234567890001" },
    { name: "businessName", label: "Razón social", type: "text", placeholder: "Ej: Comercial Andina S.A." },
    { name: "contactName", label: "Nombre de contacto", type: "text", placeholder: "Opcional" },
    { name: "phone", label: "Teléfono", type: "text", placeholder: "Opcional" },
    { name: "email", label: "Email", type: "text", placeholder: "Opcional" },
    { name: "address", label: "Dirección", type: "textarea", placeholder: "Opcional" },
    { name: "creditLimit", label: "Cupo de crédito", type: "text", placeholder: "Opcional" },
    { name: "defaultCreditDays", label: "Días de crédito por defecto", type: "text", placeholder: "Opcional" },
  ],
  defaultFormValues: wholesalerDefaultValues,
  toFormValues: (item) => ({
    businessName: item.businessName,
    ruc: item.ruc,
    contactName: item.contactName ?? "",
    phone: item.phone ?? "",
    email: item.email ?? "",
    address: item.address ?? "",
    creditLimit: item.creditLimit ? Number(item.creditLimit) : undefined,
    defaultCreditDays: item.defaultCreditDays ?? undefined,
  }),
  // create queda sin restricción (POST abierto a ADMIN y OPERATOR, sin
  // cambios); update/delete sí son admin-only, igual que Suppliers/Brands.
  permissions: {
    update: isAdmin,
    delete: isAdmin,
  },
};
