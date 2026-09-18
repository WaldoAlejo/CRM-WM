import { PlusIcon, Trash2Icon } from "lucide-react";
import type { Control, FieldErrors } from "react-hook-form";
import { useFieldArray } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { VariantFormValues } from "../variants.schema";

interface AttributesFieldArrayProps {
  control: Control<VariantFormValues>;
  errors: FieldErrors<VariantFormValues>;
}

export function AttributesFieldArray({ control, errors }: AttributesFieldArrayProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "attributePairs" });

  // El error de "agregá al menos un atributo" (.min(1) del array completo,
  // no de una fila puntual) puede quedar en .root o directo en el objeto del
  // array según cómo lo reporte el resolver — se chequean los dos.
  const arrayLevelError =
    (errors.attributePairs as { root?: { message?: string }; message?: string } | undefined)?.root?.message ??
    (errors.attributePairs as { message?: string } | undefined)?.message;

  return (
    <div className="grid gap-2">
      {/* No es un FormLabel: no está atado a un único FormField/FormItem
          (es el título del array completo), y FormLabel exige ese contexto
          o directamente lanza un error al renderizar. */}
      <Label>Atributos</Label>
      <div className="grid gap-2">
        {fields.map((field, index) => (
          <div key={field.id} className="flex items-start gap-2">
            <FormField
              control={control}
              name={`attributePairs.${index}.key`}
              render={({ field: keyField }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Input placeholder="Ej: color" {...keyField} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`attributePairs.${index}.value`}
              render={({ field: valueField }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Input placeholder="Ej: Negro" {...valueField} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => remove(index)}
              disabled={fields.length === 1}
              title="Quitar atributo"
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
      </div>
      {arrayLevelError ? <p className="text-sm font-medium text-destructive">{arrayLevelError}</p> : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => append({ key: "", value: "" })}
      >
        <PlusIcon /> Agregar atributo
      </Button>
    </div>
  );
}
