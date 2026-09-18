import { ChevronLeftIcon, ChevronRightIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import type { FieldValues } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import type { Role } from "@/types/auth";
import type { PaginationMeta } from "@/types/api";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { CrudFormDialog } from "./CrudFormDialog";
import { DataTable } from "./DataTable";
import type { CrudResourceConfig } from "./types";
import { useCrudResource } from "./useCrudResource";

function checkPermission(role: Role | null, check?: (role: Role) => boolean) {
  if (!check) return true;
  return role !== null && check(role);
}

function PaginationControls({
  pagination,
  page,
  onPageChange,
}: {
  pagination: PaginationMeta;
  page: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>
        Página {pagination.page} de {pagination.totalPages} · {pagination.total} en total
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeftIcon /> Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pagination.totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Siguiente <ChevronRightIcon />
        </Button>
      </div>
    </div>
  );
}

export function CrudTablePage<TItem extends { id: string }, TFormValues extends FieldValues>({
  config,
}: {
  config: CrudResourceConfig<TItem, TFormValues>;
}) {
  const { role } = useAuth();
  const { page, setPage, listQuery, createMutation, updateMutation, deleteMutation } = useCrudResource(config);
  const [formState, setFormState] = useState<{ open: boolean; item: TItem | null }>({
    open: false,
    item: null,
  });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const canCreate = !!config.createEndpoint && checkPermission(role, config.permissions?.create);
  const canUpdate = !!config.updateEndpoint && checkPermission(role, config.permissions?.update);
  const canDelete = !!config.deleteEndpoint && checkPermission(role, config.permissions?.delete);

  const items = listQuery.data?.data ?? [];
  const pagination = listQuery.data?.pagination ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{config.title}</h1>
        {canCreate ? (
          <Button onClick={() => setFormState({ open: true, item: null })}>
            <PlusIcon /> Nuevo {config.singular}
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={config.columns}
        data={items}
        isLoading={listQuery.isLoading}
        getRowId={(item) => item.id}
        actions={
          canUpdate || canDelete
            ? (item) => (
                <div className="flex justify-end gap-1">
                  {canUpdate ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setFormState({ open: true, item })}
                      title={`Editar ${config.singular}`}
                    >
                      <PencilIcon />
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteId(item.id)}
                      title={`Eliminar ${config.singular}`}
                    >
                      <Trash2Icon />
                    </Button>
                  ) : null}
                </div>
              )
            : undefined
        }
      />

      {pagination ? <PaginationControls pagination={pagination} page={page} onPageChange={setPage} /> : null}

      {canCreate || canUpdate ? (
        <CrudFormDialog
          config={config}
          open={formState.open}
          onOpenChange={(open) => setFormState((s) => ({ ...s, open }))}
          item={formState.item}
          createMutation={createMutation}
          updateMutation={updateMutation}
        />
      ) : null}

      {canDelete ? (
        <ConfirmDeleteDialog
          open={deleteId !== null}
          onOpenChange={(open) => !open && setDeleteId(null)}
          singular={config.singular}
          isPending={deleteMutation.isPending}
          onConfirm={() => {
            if (!deleteId) return;
            // Cierra la confirmación de inmediato: el resultado (éxito o el
            // 409 de "tiene productos activos asociados") lo comunica el
            // toast del onError/onSuccess de deleteMutation, no este dialog.
            const id = deleteId;
            setDeleteId(null);
            deleteMutation.mutate(id);
          }}
        />
      ) : null}
    </div>
  );
}
