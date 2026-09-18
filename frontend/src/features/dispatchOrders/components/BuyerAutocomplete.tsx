import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import type { FinalCustomer } from "@/features/finalCustomers/finalCustomers.types";
import type { Wholesaler } from "@/features/wholesalers/wholesalers.types";
import type { BuyerType } from "../dispatchOrders.types";
import { useFinalCustomerOptions } from "../useFinalCustomerOptions";
import { useWholesalerOptions } from "../useWholesalerOptions";

interface SelectedBuyer {
  id: string;
  label: string;
  sublabel: string;
}

interface BuyerAutocompleteProps {
  buyerType: BuyerType;
  // Objeto completo, no solo el id: CreateDispatchOrderPage necesita
  // defaultCreditDays del mayorista para prellenar creditDays.
  onSelectWholesaler: (wholesaler: Wholesaler) => void;
  onSelectFinalCustomer: (finalCustomer: FinalCustomer) => void;
  onClear: () => void;
}

// Mayorista y cliente final son mutuamente excluyentes (buyerType decide
// cuál de los dos hooks de búsqueda está activo). La selección se guarda acá
// como estado local (no en el form, que solo tiene el id) porque este
// formulario es exclusivamente de CREAR — no hay edición de una orden
// existente que necesite hidratar un comprador ya elegido.
export function BuyerAutocomplete({
  buyerType,
  onSelectWholesaler,
  onSelectFinalCustomer,
  onClear,
}: BuyerAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SelectedBuyer | null>(null);

  const wholesalers = useWholesalerOptions(buyerType === "MAYORISTA" ? query : "");
  const finalCustomers = useFinalCustomerOptions(buyerType === "CLIENTE_FINAL" ? query : "");

  useEffect(() => {
    setSelected(null);
    setQuery("");
    onClear();
    // Se limpia la selección cada vez que cambia buyerType — mismo criterio
    // que ProductFormDialog al cambiar de categoría: no se incluyen los
    // callbacks del padre en las deps a propósito, no deberían disparar
    // este efecto por sí solos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buyerType]);

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border p-2">
        <div>
          <p className="text-sm font-medium">{selected.label}</p>
          <p className="text-xs text-muted-foreground">{selected.sublabel}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => {
            setSelected(null);
            onClear();
          }}
          title="Cambiar comprador"
        >
          <XIcon />
        </Button>
      </div>
    );
  }

  if (buyerType === "MAYORISTA") {
    return (
      <Combobox<Wholesaler>
        inputValue={query}
        onInputValueChange={setQuery}
        items={wholesalers.data}
        isLoading={wholesalers.isLoading}
        getItemKey={(w) => w.id}
        placeholder="Buscar mayorista por razón social o RUC..."
        emptyMessage={query.trim().length === 0 ? "Escribí para buscar" : "Sin resultados"}
        renderItem={(w) => (
          <div>
            <p className="font-medium">{w.businessName}</p>
            <p className="text-xs text-muted-foreground">RUC {w.ruc}</p>
          </div>
        )}
        onSelect={(w) => {
          setSelected({ id: w.id, label: w.businessName, sublabel: `RUC ${w.ruc}` });
          onSelectWholesaler(w);
          setQuery("");
        }}
      />
    );
  }

  return (
    <Combobox<FinalCustomer>
      inputValue={query}
      onInputValueChange={setQuery}
      items={finalCustomers.data}
      isLoading={finalCustomers.isLoading}
      getItemKey={(c) => c.id}
      placeholder="Buscar cliente por nombre, cédula o teléfono..."
      emptyMessage={query.trim().length === 0 ? "Escribí para buscar" : "Sin resultados"}
      renderItem={(c) => (
        <div>
          <p className="font-medium">{c.fullName}</p>
          <p className="text-xs text-muted-foreground">
            {c.idType} {c.idNumber ?? "—"}
          </p>
        </div>
      )}
      onSelect={(c) => {
        setSelected({ id: c.id, label: c.fullName, sublabel: `${c.idType} ${c.idNumber ?? "—"}` });
        onSelectFinalCustomer(c);
        setQuery("");
      }}
    />
  );
}
