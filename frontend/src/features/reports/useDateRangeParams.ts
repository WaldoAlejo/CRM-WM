import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Mes calendario actual: primer día del mes en curso hasta hoy.
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: toISODate(firstOfMonth), to: toISODate(now) };
}

// El rango vive en la URL (?from=&to=), no en estado local — así "Ver
// detalle →" puede armar el link con el rango exacto, y atrás/adelante del
// navegador no lo pierde. Si se entra sin esos params, se completan solos
// (replace, sin agregar una entrada nueva al historial) apenas monta —
// nunca queda un estado "sin fecha" ambiguo.
export function useDateRangeParams() {
  const [params, setParams] = useSearchParams();
  const fromParam = params.get("from");
  const toParam = params.get("to");

  useEffect(() => {
    if (!fromParam || !toParam) {
      const defaults = defaultRange();
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("from", defaults.from);
          next.set("to", defaults.to);
          return next;
        },
        { replace: true }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromParam, toParam]);

  const defaults = defaultRange();
  const from = fromParam ?? defaults.from;
  const to = toParam ?? defaults.to;

  function setRange(newFrom: string, newTo: string) {
    setParams({ from: newFrom, to: newTo });
  }

  return { from, to, setRange };
}
