import type { ReactNode } from "react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ComboboxProps<T> {
  inputValue: string;
  onInputValueChange: (value: string) => void;
  items: T[];
  isLoading?: boolean;
  getItemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onSelect: (item: T) => void;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
}

// Shell genérico de "buscar mientras se tipea": no sabe nada de wholesalers,
// clientes finales ni variantes — cada uso le pasa sus propios `items` (ya
// resueltos por su propio hook de datos) y qué hacer con la selección. Así
// se reutiliza para los 3 buscadores del módulo de Despachos sin duplicar la
// lógica de popover/input/lista.
export function Combobox<T>({
  inputValue,
  onInputValueChange,
  items,
  isLoading,
  getItemKey,
  renderItem,
  onSelect,
  placeholder,
  emptyMessage = "Sin resultados",
  disabled,
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          value={inputValue}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            onInputValueChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (inputValue.trim().length > 0) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        // No le roba el foco al input al abrirse (ver popover.tsx): acá
        // además no cierra al hacer click adentro de la lista antes de
        // tiempo, para que el click en un ítem sí dispare onSelect.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="max-h-64 overflow-y-auto p-1">
          {isLoading ? (
            <p className="p-2 text-sm text-muted-foreground">Buscando...</p>
          ) : items.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">{emptyMessage}</p>
          ) : (
            items.map((item) => (
              <button
                key={getItemKey(item)}
                type="button"
                className={cn(
                  "flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                )}
                onClick={() => {
                  onSelect(item);
                  setOpen(false);
                }}
              >
                {renderItem(item)}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
