import { Navigate } from "react-router-dom";

// Los enlaces anteriores siguen funcionando con el proceso único de despacho.
export function CreateConsignmentLotPage() {
  return <Navigate to="/dispatch-orders/new?modality=consignment" replace />;
}
