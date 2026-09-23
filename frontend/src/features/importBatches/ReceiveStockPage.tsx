import { hasAdminAccess } from "@/lib/roles";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import type { Resolver } from "react-hook-form";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { applyApiErrorToForm } from "@/components/crud/applyApiErrorToForm";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import type { SearchResult } from "@/features/search/search.types";
import { LandedCostPreview } from "./components/LandedCostPreview";
import { ReceiveLinesTable } from "./components/ReceiveLinesTable";
import { VariantSearchAddLine } from "./components/VariantSearchAddLine";
import { receiveFormDefaultValues, receiveFormSchema } from "./importBatches.schema";
import type { ReceiveFormValues } from "./importBatches.schema";
import { costPerCbm, totalBatchCost } from "./landedCost";
import { useImportBatch } from "./useImportBatches";
import { useImportBatchMutations } from "./useImportBatchMutations";

// Cada recepción usa la misma tarifa por CBM del contenedor.
export function ReceiveStockPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role } = useAuth();
  const isAdmin = hasAdminAccess(role);
  const { data: batch, isLoading } = useImportBatch(id);
  const { receiveMutation } = useImportBatchMutations();
  const [idempotencyKey] = useState(() => globalThis.crypto.randomUUID());

  const form = useForm<ReceiveFormValues>({
    resolver: zodResolver(receiveFormSchema) as Resolver<ReceiveFormValues>,
    defaultValues: receiveFormDefaultValues,
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const lines = useWatch({ control: form.control, name: "lines" }) ?? [];

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!batch) return <p className="text-muted-foreground">Lote no encontrado.</p>;

  if (!batch.containerCbm || !batch.containerType) {
    return <p>Este lote histórico no tiene CBM registrados. Crea un lote con tipo y volumen de contenedor para recibir nueva mercadería.</p>;
  }

  const totalUnits = lines.reduce((sum, l) => sum + (Number(l?.quantity) || 0), 0);
  const originTotal = lines.reduce((sum, l) => sum + (Number(l?.quantity) || 0) * (Number(l?.unitCost) || 0), 0);
  // Los costos del lote vienen del propio lote (ya guardados), no del form.
  const totalCost = totalBatchCost({
    freightCost: Number(batch.freightCost) || 0,
    customsCost: Number(batch.customsCost) || 0,
    otherCosts: Number(batch.otherCosts) || 0,
  });
  const proration = costPerCbm(totalCost, Number(batch.containerCbm));
  const volumeCbm = lines.reduce((sum, l) => sum + (Number(l?.volumeCbm) || 0), 0);

  function handleAddLine(result: SearchResult) {
    append({
      variantId: result.variantId,
      sku: result.sku,
      label: result.label,
      productName: result.product.name,
      quantity: 1,
      unitCost: 0,
      volumeCbm: 0,
      locationId: "",
      notes: undefined,
    });
  }

  function handleSubmit(values: ReceiveFormValues) {
    const receivedCbm = batch!.movements.reduce((sum, m) => sum + Number(m.volumeCbm ?? 0), 0);
    if (receivedCbm + values.lines.reduce((sum, l) => sum + l.volumeCbm, 0) - Number(batch!.containerCbm) > 0.0000001) {
      form.setError("lines", { message: "Los CBM superan el volumen disponible del lote" });
      return;
    }
    receiveMutation
      .mutateAsync({
        id: batch!.id,
        idempotencyKey,
        lines: values.lines.map((l) => ({
          variantId: l.variantId,
          packaging: l.packaging,
          quantity: l.quantity,
          unitCost: l.unitCost,
          volumeCbm: l.volumeCbm,
          locationId: l.locationId,
          notes: l.notes || undefined,
        })),
      })
      .then(() => navigate(`/import-batches/${batch!.id}`))
      .catch((error: unknown) => applyApiErrorToForm(error, form));
  }

  return (
    <div className="space-y-6">
      <Link
        to={`/import-batches/${batch.id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeftIcon className="size-4" /> {batch.reference}
      </Link>
      <h1 className="text-2xl font-semibold">Recibir mercadería · {batch.reference}</h1>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
          {isAdmin ? (
            <LandedCostPreview
              totalCost={totalCost}
              totalUnits={totalUnits}
              costPerCbm={proration}
                volumeCbm={volumeCbm}
              originTotal={originTotal}
            />
          ) : null}
          <section className="space-y-3 rounded-md border p-4">
            <VariantSearchAddLine
              existingVariantIds={new Set(lines.map((l) => l?.variantId as string))}
              onAdd={handleAddLine}
            />
            <ReceiveLinesTable
              control={form.control}
              errors={form.formState.errors}
              fields={fields}
              remove={remove}
              costPerCbm={isAdmin ? proration : null}
            />
          </section>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => navigate(`/import-batches/${batch.id}`)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={receiveMutation.isPending}>
              {receiveMutation.isPending ? "Recibiendo..." : "Recibir mercadería"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
