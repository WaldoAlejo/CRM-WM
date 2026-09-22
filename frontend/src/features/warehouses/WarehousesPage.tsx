import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { ConfirmDeleteDialog } from "@/components/crud/ConfirmDeleteDialog";
import { DataTable } from "@/components/crud/DataTable";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { WarehouseFormDialog } from "./WarehouseFormDialog";
import { useWarehouseMutations } from "./useWarehouseMutations";
import { useWarehouseOptions } from "./useWarehouseOptions";
import { warehousesConfig } from "./warehouses.config";
import type { Warehouse } from "./warehouses.types";

// No usa CrudTablePage: el formulario de Bodegas necesita un selector de
// responsable con datos vivos (usuarios ADMIN/OPERATOR/CEO activos), algo
// que el diálogo genérico no sabe hacer — ver warehouses.config.tsx. Lista,
// tabla y borrado siguen el mismo patrón (DataTable + ConfirmDeleteDialog),
// solo el diálogo de crear/editar es propio (WarehouseFormDialog).
export function WarehousesPage() {
  const { role } = useAuth();
  const { data, isLoading } = useWarehouseOptions();
  const { deleteMutation } = useWarehouseMutations();
  const [editing, setEditing] = useState<Warehouse | "new" | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const canCreate = !!role && !!warehousesConfig.permissions?.create?.(role);
  const canUpdate = !!role && !!warehousesConfig.permissions?.update?.(role);
  const canDelete = !!role && !!warehousesConfig.permissions?.delete?.(role);

  const warehouses = data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bodegas</h1>
        {canCreate ? (
          <Button onClick={() => setEditing("new")}>
            <PlusIcon /> Nueva bodega
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={warehousesConfig.columns}
        data={warehouses}
        isLoading={isLoading}
        getRowId={(item) => item.id}
        actions={
          canUpdate || canDelete
            ? (item) => (
                <div className="flex justify-end gap-1">
                  {canUpdate ? (
                    <Button variant="ghost" size="icon" title="Editar bodega" onClick={() => setEditing(item)}>
                      <PencilIcon />
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <Button variant="ghost" size="icon" title="Eliminar bodega" onClick={() => setDeleteId(item.id)}>
                      <Trash2Icon />
                    </Button>
                  ) : null}
                </div>
              )
            : undefined
        }
      />

      {canCreate || canUpdate ? (
        <WarehouseFormDialog
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
          warehouse={editing === "new" ? null : editing}
        />
      ) : null}

      {canDelete ? (
        <ConfirmDeleteDialog
          open={deleteId !== null}
          onOpenChange={(open) => !open && setDeleteId(null)}
          singular="bodega"
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
