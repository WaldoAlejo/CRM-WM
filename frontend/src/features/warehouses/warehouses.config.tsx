import { hasAdminAccess } from "@/lib/roles";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import type { CrudResourceConfig } from "@/components/crud/types";
import type { Role } from "@/types/auth";
import { warehouseDefaultValues, warehouseFormSchema } from "./warehouses.schema";
import type { Warehouse } from "./warehouses.types";

const isAdmin = (role: Role) => hasAdminAccess(role);

export const warehousesConfig: CrudResourceConfig<Warehouse, typeof warehouseDefaultValues> = {
  resourceKey: "warehouses",
  title: "Bodegas",
  singular: "bodega",
  listEndpoint: "/warehouses",
  createEndpoint: "/warehouses",
  updateEndpoint: (id) => `/warehouses/${id}`,
  // Igual que Courier: DELETE responde 204 sin body, isActive=false por
  // dentro es un detalle interno que no cambia el contrato HTTP.
  deleteEndpoint: (id) => `/warehouses/${id}`,
  columns: [
    { header: "Nombre", cell: (item) => item.name },
    { header: "Dirección", cell: (item) => item.address ?? "—" },
    {
      header: "Ubicaciones",
      cell: (item) => (
        <Link to={`/catalog/warehouses/${item.id}/locations`} className="text-sm text-primary hover:underline">
          {item.locations.length} ubicación(es)
        </Link>
      ),
    },
    {
      header: "Estado",
      cell: (item) => (
        <Badge variant={item.isActive ? "default" : "secondary"}>{item.isActive ? "Activo" : "Inactivo"}</Badge>
      ),
    },
  ],
  formSchema: warehouseFormSchema,
  formFields: [
    { name: "name", label: "Nombre", type: "text", placeholder: "Ej: Bodega Central" },
    { name: "address", label: "Dirección", type: "textarea", placeholder: "Opcional" },
  ],
  defaultFormValues: warehouseDefaultValues,
  toFormValues: (item) => ({ name: item.name, address: item.address ?? "" }),
  permissions: {
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
};
