import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import type { Resolver } from "react-hook-form";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { applyApiErrorToForm } from "@/components/crud/applyApiErrorToForm";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import type { SearchResult } from "@/features/search/search.types";
import { LandedCostPreview } from "./components/LandedCostPreview";
import { ReceiveLinesTable } from "./components/ReceiveLinesTable";
import { VariantSearchAddLine } from "./components/VariantSearchAddLine";
import { createImportBatchDefaultValues, createImportBatchFormSchema } from "./importBatches.schema";
import type { CreateImportBatchFormValues } from "./importBatches.schema";
import { prorationPerUnit, totalBatchCost } from "./landedCost";
import { useImportBatchMutations } from "./useImportBatchMutations";
import { useSupplierOptions } from "./useSupplierOptions";

export function CreateImportBatchPage() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const isAdmin = role === "ADMIN";
  const { createMutation, receiveMutation } = useImportBatchMutations();
  const { data: suppliers } = useSupplierOptions();

  // Si el lote se crea pero la recepción falla, se conserva el id: el
  // reintento solo repite la recepción (misma Idempotency-Key), nunca crea un
  // segundo lote con otra referencia.
  const [createdBatchId, setCreatedBatchId] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => globalThis.crypto.randomUUID());

  const form = useForm<CreateImportBatchFormValues>({
    resolver: zodResolver(createImportBatchFormSchema) as Resolver<CreateImportBatchFormValues>,
    defaultValues: createImportBatchDefaultValues(),
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const lines = useWatch({ control: form.control, name: "lines" }) ?? [];
  const freightCost = useWatch({ control: form.control, name: "freightCost" });
  const customsCost = useWatch({ control: form.control, name: "customsCost" });
  const otherCosts = useWatch({ control: form.control, name: "otherCosts" });

  const totalUnits = lines.reduce((sum, l) => sum + (Number(l?.quantity) || 0), 0);
  const originTotal = lines.reduce((sum, l) => sum + (Number(l?.quantity) || 0) * (Number(l?.unitCost) || 0), 0);
  const totalCost = totalBatchCost({
    freightCost: Number(freightCost) || 0,
    customsCost: Number(customsCost) || 0,
    otherCosts: Number(otherCosts) || 0,
  });
  const proration = prorationPerUnit(totalCost, totalUnits);

  function handleAddLine(result: SearchResult) {
    append({
      variantId: result.variantId,
      sku: result.sku,
      label: result.label,
      productName: result.product.name,
      quantity: 1,
      unitCost: 0,
      locationId: undefined,
      notes: undefined,
    });
  }

  async function handleSubmit(values: CreateImportBatchFormValues) {
    try {
      let batchId = createdBatchId;
      if (!batchId) {
        const created = await createMutation.mutateAsync({
          reference: values.reference,
          supplierId: values.supplierId,
          arrivalDate: values.arrivalDate,
          notes: values.notes || undefined,
          // OPERATOR no renderiza estos campos (quedan undefined): el
          // backend responde 403 si un OPERATOR los manda.
          ...(isAdmin
            ? { freightCost: values.freightCost, customsCost: values.customsCost, otherCosts: values.otherCosts }
            : {}),
        });
        batchId = created.id;
        setCreatedBatchId(batchId);
      }

      await receiveMutation.mutateAsync({
        id: batchId,
        idempotencyKey,
        lines: values.lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          unitCost: l.unitCost,
          locationId: l.locationId || undefined,
          notes: l.notes || undefined,
        })),
      });
      navigate(`/import-batches/${batchId}`);
    } catch (error) {
      applyApiErrorToForm(error, form);
    }
  }

  const existingVariantIds = new Set(lines.map((l) => l?.variantId));
  const isPending = createMutation.isPending || receiveMutation.isPending;
  const headerLocked = createdBatchId !== null;

  return (
    <div className="space-y-6">
      <Link
        to="/import-batches"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeftIcon className="size-4" /> Importaciones
      </Link>

      <h1 className="text-2xl font-semibold">Nuevo lote de importación</h1>

      {headerLocked ? (
        <p className="rounded-md border border-destructive/50 p-3 text-sm">
          El lote ya se creó, pero la recepción no se completó. Revisá las líneas y reintentá: no se va a crear un
          lote duplicado.
        </p>
      ) : null}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
          <section className="grid grid-cols-2 gap-4 rounded-md border p-4">
            <h2 className="col-span-2 text-lg font-semibold">Lote</h2>
            <FormField
              control={form.control}
              name="reference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Referencia / contenedor</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: CONT-2026-001" disabled={headerLocked} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="arrivalDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de llegada</FormLabel>
                  <FormControl>
                    <Input type="date" disabled={headerLocked} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="supplierId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Proveedor</FormLabel>
                  <Select
                    value={field.value ?? "none"}
                    onValueChange={(value) => field.onChange(value === "none" ? undefined : value)}
                    disabled={headerLocked}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Sin proveedor" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">Sin proveedor</SelectItem>
                      {(suppliers ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Opcional" disabled={headerLocked} {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </section>

          {/* Los costos del lote (flete/aranceles/otros) son admin-only: el
              backend responde 403 si OPERATOR los manda, y la vista previa
              de prorrateo depende de ellos — para OPERATOR ni se renderiza. */}
          {isAdmin ? (
            <section className="space-y-3 rounded-md border p-4">
              <h2 className="text-lg font-semibold">Costos a prorratear</h2>
              <div className="grid grid-cols-3 gap-4">
                {(
                  [
                    ["freightCost", "Flete internacional"],
                    ["customsCost", "Aranceles / nacionalización"],
                    ["otherCosts", "Otros costos"],
                  ] as const
                ).map(([name, label]) => (
                  <FormField
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{label}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            placeholder="0.00"
                            disabled={headerLocked}
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
              <LandedCostPreview
                totalCost={totalCost}
                totalUnits={totalUnits}
                prorationPerUnit={proration}
                originTotal={originTotal}
              />
            </section>
          ) : null}

          <section className="space-y-3 rounded-md border p-4">
            <h2 className="text-lg font-semibold">Mercadería recibida</h2>
            <VariantSearchAddLine existingVariantIds={existingVariantIds as Set<string>} onAdd={handleAddLine} />
            <ReceiveLinesTable
              control={form.control}
              errors={form.formState.errors}
              fields={fields}
              remove={remove}
              prorationPerUnit={isAdmin ? proration : null}
            />
          </section>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => navigate("/import-batches")}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando..." : headerLocked ? "Reintentar recepción" : "Crear lote y recibir"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
