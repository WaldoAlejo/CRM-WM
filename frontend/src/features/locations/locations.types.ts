export interface Location {
  id: string;
  warehouseId: string;
  type?: "STANDARD" | "CUARENTENA";
  code: string;
  aisle: string | null;
  shelf: string | null;
  level: string | null;
  isActive: boolean;
  createdAt: string;
}
