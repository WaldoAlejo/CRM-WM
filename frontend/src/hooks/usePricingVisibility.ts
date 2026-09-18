import { useAuth } from "@/context/AuthContext";

// `role` de AuthContext es síncrono desde el primer render (useState con
// inicializador lazy leyendo localStorage, sin useEffect de por medio — ver
// AuthContext.tsx) — nunca hay un estado "cargando sesión" intermedio en el
// que este hook pudiera devolver true por defecto antes de saber el rol real.
// `null` (sin sesión) y "OPERATOR" caen ambos a `false`, la opción segura.
export function usePricingVisibility(): boolean {
  const { role } = useAuth();
  return role === "ADMIN";
}
