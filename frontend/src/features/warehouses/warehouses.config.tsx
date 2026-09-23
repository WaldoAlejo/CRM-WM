import { hasAdminAccess } from "@/lib/roles";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import type { CrudResourceConfig } from "@/components/crud/types";
import type { Role } from "@/types/auth";
import type { WarehouseFormValues } from "./warehouses.schema";
import type { Warehouse } from "./warehouses.types";

const isAdmin = (role: Role) => hasAdminAccess(role);

// Sin formSchema/formFields/defaultFormValues: el formulario de Bodegas
// necesita un selector de responsable con datos vivos (usuarios ADMIN/
// OPERATOR/CEO activos), algo que el diálogo genérico (texto/textarea/select
// de opciones ESTÁTICAS) no sabe hacer — así que usa su propio
// WarehouseFormDialog (ver WarehousesPage.tsx), igual que ya hacen Variantes
// y Consignación. Esta config solo aporta endpoints/columnas/permisos, que
// useCrudResource sigue reutilizando tal cual.
export const warehousesConfig: CrudResourceConfig<Warehouse, WarehouseFormValues> = {
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
    { header: "Capacidad", cell: (item) => (item.capacityCbm != null ? `${Number(item.capacityCbm).toLocaleString("es-EC", { maximumFractionDigits: 3 })} m³` : "—") },
    { header: "Teléfono", cell: (item) => item.phone ?? "—" },
    {
      header: "Responsable",
      cell: (item) => (item.manager ? `${item.manager.name} (${item.manager.role})` : "—"),
    },
    { header: "Notas", cell: (item) => item.notes ?? "—" },
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
  permissions: {
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
};
