import { SearchIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";

// Accesible desde CUALQUIER pantalla (vive en el topbar del layout general,
// no solo dentro de Productos): el flujo real es "buscar → ver qué hay →
// despachar", que empieza mucho antes de estar parado en el módulo de
// catálogo.
export function GlobalSearchBar() {
  const [value, setValue] = useState("");
  const navigate = useNavigate();

  return (
    <form
      className="relative w-64"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) navigate(`/search?q=${encodeURIComponent(value.trim())}`);
      }}
    >
      <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Buscar por SKU, código de barras..."
        className="pl-8"
      />
    </form>
  );
}
