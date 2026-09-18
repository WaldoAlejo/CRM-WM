import type { Location } from "../locations/locations.types";

export interface Warehouse {
  id: string;
  name: string;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  locations: Location[];
}
