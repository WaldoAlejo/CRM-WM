import { useEffect, useState } from "react";

// Evita 1 request por tecla en los buscadores (variantes, mayoristas,
// clientes finales): el valor debounced es el que alimenta la queryKey de
// React Query, nunca el input crudo.
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}
