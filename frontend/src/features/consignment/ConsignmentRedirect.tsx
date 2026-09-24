import { Navigate, useParams, useSearchParams } from "react-router-dom";

// Conserva los enlaces guardados y las alertas anteriores al cambio de navegación.
export function ConsignmentRedirect() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  if (id) return <Navigate to={`/dispatch-orders/consignment/${encodeURIComponent(id)}`} replace />;
  const params = new URLSearchParams(searchParams);
  params.set("view", "consignment");
  return <Navigate to={`/dispatch-orders?${params}`} replace />;
}
