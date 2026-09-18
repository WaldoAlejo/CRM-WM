import { toast } from "sonner";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { ApiError } from "@/lib/api";

// Traduce un error de la API a: (a) un toast siempre visible con el mensaje,
// y (b) si el error apunta a un campo específico del formulario, lo resalta
// ahí en vez de dejar el mensaje solo en el toast. Dos formas reales de error
// (ver backend/src/middleware/errorHandler.ts):
// 1. HttpError con UN campo:  { error, field }
// 2. ZodError con VARIOS:     { error: "Datos inválidos", details: [{campo, mensaje}] }
export function applyApiErrorToForm<TFormValues extends FieldValues>(
  error: unknown,
  form: UseFormReturn<TFormValues>
) {
  if (!(error instanceof ApiError)) {
    toast.error("Ocurrió un error inesperado. Intenta de nuevo.");
    return;
  }

  if (error.details && error.details.length > 0) {
    for (const issue of error.details) {
      form.setError(issue.campo as Path<TFormValues>, { message: issue.mensaje });
    }
  } else if (error.field) {
    form.setError(error.field as Path<TFormValues>, { message: error.message });
  }

  toast.error(error.message);
}
