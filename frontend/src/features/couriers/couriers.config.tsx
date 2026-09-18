import { Badge } from "@/components/ui/badge";
import type { CrudResourceConfig } from "@/components/crud/types";
import type { Role } from "@/types/auth";
import { courierDefaultValues, courierFormSchema } from "./couriers.schema";
import type { Courier } from "./couriers.types";

const isAdmin = (role: Role) => role === "ADMIN";

export const couriersConfig: CrudResourceConfig<Courier, typeof courierDefaultValues> = {
  resourceKey: "couriers",
  title: "Couriers",
  singular: "courier",
  listEndpoint: "/couriers",
  createEndpoint: "/couriers",
  updateEndpoint: (id) => `/couriers/${id}`,
  // Verificado contra backend/src/modules/couriers/couriers.controller.ts:
  // DELETE /api/couriers/:id responde 204 sin body, EXACTAMENTE igual que
  // Suppliers/Brands/FinalCustomers — la diferencia (isActive=false en vez
  // de deletedAt) es un detalle interno del backend que no cambia el
  // contrato HTTP, así que no hace falta ningún manejo especial acá.
  deleteEndpoint: (id) => `/couriers/${id}`,
  columns: [
    { header: "Nombre", cell: (item) => item.name },
    { header: "Contacto", cell: (item) => item.contactInfo ?? "—" },
    {
      header: "Estado",
      cell: (item) => (
        <Badge variant={item.isActive ? "default" : "secondary"}>{item.isActive ? "Activo" : "Inactivo"}</Badge>
      ),
    },
  ],
  formSchema: courierFormSchema,
  formFields: [
    { name: "name", label: "Nombre", type: "text", placeholder: "Ej: Servientrega" },
    { name: "contactInfo", label: "Información de contacto", type: "textarea", placeholder: "Teléfono, email..." },
  ],
  defaultFormValues: courierDefaultValues,
  toFormValues: (item) => ({ name: item.name, contactInfo: item.contactInfo ?? "" }),
  permissions: {
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
};
