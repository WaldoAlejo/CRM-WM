import { LogOutIcon } from "lucide-react";
import { Outlet } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { GlobalSearchBar } from "@/features/search/GlobalSearchBar";
import { Sidebar } from "./Sidebar";

export function AppLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-6">
          <GlobalSearchBar />
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{user?.email}</span>
            <Badge variant="secondary">{user?.role}</Badge>
            <Button variant="ghost" size="icon" onClick={logout} title="Cerrar sesión">
              <LogOutIcon />
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
