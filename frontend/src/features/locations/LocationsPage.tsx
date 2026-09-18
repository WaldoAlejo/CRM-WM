import { ArrowLeftIcon } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { CrudTablePage } from "@/components/crud/CrudTablePage";
import { useWarehouse } from "../warehouses/useWarehouse";
import { buildLocationsConfig } from "./locations.config";

export function LocationsPage() {
  const { warehouseId } = useParams<{ warehouseId: string }>();
  const { data: warehouse } = useWarehouse(warehouseId);

  if (!warehouseId) return null;

  return (
    <div className="space-y-4">
      <Link
        to="/catalog/warehouses"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeftIcon className="size-4" /> Bodegas
      </Link>
      {warehouse ? <p className="text-sm text-muted-foreground">Bodega: {warehouse.name}</p> : null}
      <CrudTablePage config={buildLocationsConfig(warehouseId)} />
    </div>
  );
}
