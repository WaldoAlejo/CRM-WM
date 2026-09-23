import type { Role } from "@/types/auth";
import type { WarehouseLayout } from "./warehouseLayout";
import type { Location } from "../locations/locations.types";

export interface WarehouseManagerRef {
  id: string;
  name: string;
  role: Role;
}

export interface Warehouse {
  id: string;
  name: string;
  address: string | null;
  capacity: number | null;
  phone: string | null;
  notes: string | null;
  manager: WarehouseManagerRef | null;
  isActive: boolean;
  createdAt: string;
  locations: Location[];
  layout?: WarehouseLayout | null;
}
