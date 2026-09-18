import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, clearToken, getToken, setToken, setUnauthorizedHandler } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import type { AuthUser, LoginResponse, Role } from "@/types/auth";

const USER_KEY = "wm_kestore_user";

function readStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

interface AuthContextValue {
  user: AuthUser | null;
  role: Role | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => (getToken() ? readStoredUser() : null));

  function logout() {
    clearToken();
    localStorage.removeItem(USER_KEY);
    setUser(null);
    queryClient.clear();
  }

  async function login(email: string, password: string) {
    const result = await apiFetch<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(result.token);
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    setUser(result.user);
  }

  // apiFetch no puede navegar ni tocar el estado de React por su cuenta (no
  // es un hook): se registra este handler UNA vez, y es quien realmente
  // reacciona a un 401 (logout limpia token+estado; la redirección a /login
  // la hace RequireAuth en el próximo render, al ver isAuthenticated=false).
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      role: user?.role ?? null,
      isAuthenticated: user !== null,
      login,
      logout,
    }),
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
