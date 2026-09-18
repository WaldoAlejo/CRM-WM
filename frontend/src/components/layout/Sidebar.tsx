import { NavLink } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { roleSatisfies } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { Role } from "@/types/auth";
import type { NavItem } from "./nav-items";
import { NAV_ITEMS } from "./nav-items";

function isVisible(item: NavItem, role: string | null): boolean {
  if (!item.roles) return true;
  // Jerarquía: roles: ["ADMIN"] = ADMIN o superior (CEO); ["CEO"] = solo CEO.
  return roleSatisfies(role as Role | null, item.roles);
}

function NavLinkItem({ item }: { item: NavItem }) {
  if (!item.path) return null;
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      end={item.path === "/"}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )
      }
    >
      {Icon ? <Icon className="size-4 shrink-0" /> : null}
      {item.label}
    </NavLink>
  );
}

export function Sidebar() {
  const { role } = useAuth();
  const visibleItems = NAV_ITEMS.filter((item) => isVisible(item, role));

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r bg-background">
      <div className="flex h-14 items-center border-b px-4">
        <span className="text-sm font-semibold">WM / Kestore</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {visibleItems.map((item) =>
          item.children ? (
            <div key={item.label} className="flex flex-col gap-1 pt-2">
              <div className="flex items-center gap-2 px-3 py-1 text-xs font-semibold uppercase text-muted-foreground">
                {item.icon ? <item.icon className="size-3.5" /> : null}
                {item.label}
              </div>
              {item.children.filter((child) => isVisible(child, role)).map((child) => (
                <div key={child.label} className="pl-4">
                  <NavLinkItem item={child} />
                </div>
              ))}
            </div>
          ) : (
            <NavLinkItem key={item.label} item={item} />
          )
        )}
      </nav>
    </aside>
  );
}
