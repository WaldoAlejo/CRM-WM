import { hasAdminAccess } from "@/lib/roles";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { ConfirmDeleteDialog } from "@/components/crud/ConfirmDeleteDialog";
import { CrudFormDialog } from "@/components/crud/CrudFormDialog";
import { DataTable } from "@/components/crud/DataTable";
import { useCrudResource } from "@/components/crud/useCrudResource";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { wholesalersConfig } from "./wholesalers.config";
import { WholesalerFormDialog } from "./WholesalerFormDialog";
import type { Wholesaler } from "./wholesalers.types";

// Página a medida solo para CREAR (el botón "Validar RUC" no es parte del
// patrón genérico — ver wholesalers.config.tsx). Editar/eliminar SÍ reusan
// los componentes genéricos (CrudFormDialog/ConfirmDeleteDialog) tal cual los
// usa CrudTablePage — no hace falta reinventarlos acá solo porque crear es distinto.
export function WholesalersPage() {
  const { role } = useAuth();
  const { listQuery, createMutation, updateMutation, deleteMutation } = useCrudResource(wholesalersConfig);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Wholesaler | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const items = listQuery.data?.data ?? [];
  const canUpdate = hasAdminAccess(role);
  const canDelete = hasAdminAccess(role);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{wholesalersConfig.title}</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon /> Nuevo mayorista
        </Button>
      </div>

      <DataTable
        columns={wholesalersConfig.columns}
        data={items}
        isLoading={listQuery.isLoading}
        getRowId={(item) => item.id}
        actions={
          canUpdate || canDelete
            ? (item) => (
                <div className="flex justify-end gap-1">
                  {canUpdate ? (
                    <Button variant="ghost" size="icon" onClick={() => setEditing(item)} title="Editar mayorista">
                      <PencilIcon />
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteId(item.id)}
                      title="Eliminar mayorista"
                    >
                      <Trash2Icon />
                    </Button>
                  ) : null}
                </div>
              )
            : undefined
        }
      />

      <WholesalerFormDialog open={createOpen} onOpenChange={setCreateOpen} createMutation={createMutation} />

      {canUpdate ? (
        <CrudFormDialog
          config={wholesalersConfig}
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
          item={editing}
          createMutation={createMutation}
          updateMutation={updateMutation}
        />
      ) : null}

      {canDelete ? (
        <ConfirmDeleteDialog
          open={deleteId !== null}
          onOpenChange={(open) => !open && setDeleteId(null)}
          singular={wholesalersConfig.singular}
          isPending={deleteMutation.isPending}
          onConfirm={() => {
            if (!deleteId) return;
            const id = deleteId;
            setDeleteId(null);
            deleteMutation.mutate(id);
          }}
        />
      ) : null}
    </div>
  );
}
