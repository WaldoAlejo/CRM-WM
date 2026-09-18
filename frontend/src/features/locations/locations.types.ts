export interface Location {
  id: string;
  warehouseId: string;
  code: string;
  aisle: string | null;
  shelf: string | null;
  level: string | null;
  isActive: boolean;
  createdAt: string;
}
