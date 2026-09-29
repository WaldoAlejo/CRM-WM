import * as DialogPrimitive from "@radix-ui/react-dialog";
import { LogOutIcon, MenuIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { GlobalSearchBar } from "@/features/search/GlobalSearchBar";
import { Sidebar, SidebarNav } from "./Sidebar";

// Menú deslizable para teléfono y tablet (< lg). En escritorio se usa la
// barra lateral fija; ambos comparten SidebarNav.
function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button variant="ghost" size="icon" className="shrink-0 lg:hidden" aria-label="Abrir menú">
          <MenuIcon />
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 lg:hidden" />
        <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r bg-background shadow-lg lg:hidden">
          <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
            <DialogPrimitive.Title className="text-sm font-semibold">WM / Kestore</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Cerrar menú">
                <XIcon />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">Navegación principal</DialogPrimitive.Description>
          <SidebarNav onNavigate={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function AppLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3 sm:gap-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <MobileNav />
            <GlobalSearchBar />
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span className="hidden text-sm text-muted-foreground md:inline">{user?.email}</span>
            <Badge variant="secondary" className="hidden sm:inline-flex">{user?.role}</Badge>
            <Button variant="ghost" size="icon" onClick={logout} title="Cerrar sesión" aria-label="Cerrar sesión">
              <LogOutIcon />
            </Button>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
