import type { CrudResourceConfig } from "@/components/crud/types";
import type { Role } from "@/types/auth";
import { finalCustomerDefaultValues, finalCustomerFormSchema } from "./finalCustomers.schema";
import type { FinalCustomer } from "./finalCustomers.types";

const isAdmin = (role: Role) => role === "ADMIN";

const ID_TYPE_LABELS: Record<FinalCustomer["idType"], string> = {
  CEDULA: "Cédula",
  PASAPORTE: "Pasaporte",
  RUC: "RUC",
};

export const finalCustomersConfig: CrudResourceConfig<FinalCustomer, typeof finalCustomerDefaultValues> = {
  resourceKey: "finalCustomers",
  title: "Clientes",
  singular: "cliente",
  listEndpoint: "/final-customers",
  createEndpoint: "/final-customers",
  updateEndpoint: (id) => `/final-customers/${id}`,
  deleteEndpoint: (id) => `/final-customers/${id}`,
  columns: [
    { header: "Nombre", cell: (item) => item.fullName },
    {
      header: "Identificación",
      cell: (item) =>
        item.idNumber ? `${ID_TYPE_LABELS[item.idType]} · ${item.idNumber}` : `${ID_TYPE_LABELS[item.idType]} · —`,
    },
  ],
  formSchema: finalCustomerFormSchema,
  formFields: [
    { name: "fullName", label: "Nombre completo", type: "text", placeholder: "Ej: Juan Pérez" },
    {
      name: "idType",
      label: "Tipo de identificación",
      type: "select",
      options: [
        { value: "CEDULA", label: "Cédula" },
        { value: "PASAPORTE", label: "Pasaporte" },
        { value: "RUC", label: "RUC" },
      ],
    },
    { name: "idNumber", label: "Número de identificación", type: "text", placeholder: "Opcional" },
    { name: "phone", label: "Teléfono", type: "text", placeholder: "Opcional" },
    { name: "email", label: "Email", type: "text", placeholder: "Opcional" },
    { name: "address", label: "Dirección", type: "textarea", placeholder: "Opcional" },
  ],
  defaultFormValues: finalCustomerDefaultValues,
  toFormValues: (item) => ({
    fullName: item.fullName,
    idType: item.idType,
    idNumber: item.idNumber ?? "",
    phone: item.phone ?? "",
    email: item.email ?? "",
    address: item.address ?? "",
  }),
  // A diferencia de Suppliers/Brands/Couriers (POST admin-only): registrar un
  // cliente final es tarea operativa del día a día, igual que crear una
  // orden — admin Y operador pueden hacerlo (sin permissions.create acá, se
  // interpreta como "sin restricción" en checkPermission). Editar/eliminar
  // sí quedan admin-only.
  permissions: {
    update: isAdmin,
    delete: isAdmin,
  },
};
