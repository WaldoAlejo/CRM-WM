import { useEffect, useRef } from "react";
import type { FieldErrors, FieldValues } from "react-hook-form";

// Al fallar la validación, el primer error puede quedar fuera de la vista: la
// columna de bodega está a la derecha de una tabla con scroll horizontal y el
// usuario solo ve que el botón "no hace nada". Se centra el primer mensaje de
// error (orden del DOM) y se enfoca el campo de su fila, si es enfocable.
export function scrollToFirstError(form: HTMLFormElement | null) {
  const message = form?.querySelector<HTMLElement>('[id$="-form-item-message"], [data-form-error]');
  if (!message) return;
  message.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  message.parentElement?.querySelector<HTMLElement>("input:not([disabled]), button:not([disabled]), textarea:not([disabled])")?.focus({ preventScroll: true });
}

// Corre después de que React pinta los mensajes de un envío fallido; usar con
// `shouldFocusError: false` (el foco nativo no llega a la bodega, un Select sin ref).
export function useScrollToFirstError<T extends FieldValues>(formState: { submitCount: number; errors: FieldErrors<T> }) {
  const ref = useRef<HTMLFormElement>(null);
  const { submitCount, errors } = formState;
  const hasErrors = Object.keys(errors).length > 0;
  useEffect(() => {
    if (submitCount > 0 && hasErrors) scrollToFirstError(ref.current);
    // Solo tras cada envío: corregir un campo no debe volver a mover la página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitCount]);
  return ref;
}
