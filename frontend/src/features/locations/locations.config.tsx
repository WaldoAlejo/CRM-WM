import type { CrudResourceConfig } from "@/components/crud/types";
import type { Role } from "@/types/auth";
import { locationDefaultValues, locationFormSchema } from "./locations.schema";
import type { Location } from "./locations.types";

const isAdmin = (role: Role) => role === "ADMIN";

// A diferencia del resto del catálogo (endpoints fijos), Location está
// anidada bajo una bodega concreta — el listado/creación viven en
// /warehouses/:warehouseId/locations. Por eso esto es una función, no un
// objeto constante: LocationsPage la arma con el warehouseId que sale de la
// URL.
export function buildLocationsConfig(
  warehouseId: string
): CrudResourceConfig<Location, typeof locationDefaultValues> {
  return {
    // Incluye warehouseId para que el caché de react-query no mezcle las
    // ubicaciones de dos bodegas distintas bajo la misma queryKey.
    resourceKey: `locations-${warehouseId}`,
    title: "Ubicaciones",
    singular: "ubicación",
    listEndpoint: `/warehouses/${warehouseId}/locations`,
    createEndpoint: `/warehouses/${warehouseId}/locations`,
    updateEndpoint: (id) => `/locations/${id}`,
    deleteEndpoint: (id) => `/locations/${id}`,
    columns: [
      { header: "Código", cell: (item) => item.code },
      { header: "Pasillo", cell: (item) => item.aisle ?? "—" },
      { header: "Estante", cell: (item) => item.shelf ?? "—" },
      { header: "Nivel", cell: (item) => item.level ?? "—" },
    ],
    formSchema: locationFormSchema,
    formFields: [
      { name: "code", label: "Código", type: "text", placeholder: "Ej: A-3-2 o Recepción" },
      { name: "aisle", label: "Pasillo", type: "text", placeholder: "Opcional" },
      { name: "shelf", label: "Estante", type: "text", placeholder: "Opcional" },
      { name: "level", label: "Nivel", type: "text", placeholder: "Opcional" },
    ],
    defaultFormValues: locationDefaultValues,
    toFormValues: (item) => ({
      code: item.code,
      aisle: item.aisle ?? "",
      shelf: item.shelf ?? "",
      level: item.level ?? "",
    }),
    permissions: {
      create: isAdmin,
      update: isAdmin,
      delete: isAdmin,
    },
  };
}
