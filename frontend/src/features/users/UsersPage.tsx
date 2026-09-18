import { KeyIcon, PencilIcon, PlusIcon, PowerIcon, PowerOffIcon } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/crud/DataTable";
import type { CrudColumn } from "@/components/crud/types";
import { useAuth } from "@/context/AuthContext";
import { isCeo } from "@/lib/roles";
import { CreateUserDialog } from "./CreateUserDialog";
import { EditUserDialog } from "./EditUserDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
import type { AdminUser } from "./users.types";
import { useUserMutations } from "./useUserMutations";
import { useUsers } from "./useUsers";

export function UsersPage() {
  const { user: currentUser, role: currentRole } = useAuth();
  const { data: users, isLoading } = useUsers();
  const { toggleActiveMutation } = useUserMutations();

  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [resettingUser, setResettingUser] = useState<AdminUser | null>(null);
  const [deactivatingUser, setDeactivatingUser] = useState<AdminUser | null>(null);

  const columns: CrudColumn<AdminUser>[] = [
    { header: "Nombre", cell: (item) => item.name },
    { header: "Email", cell: (item) => item.email },
    {
      header: "Rol",
      cell: (item) => <Badge variant={item.role === "OPERATOR" ? "secondary" : "default"}>{item.role}</Badge>,
    },
    {
      header: "Estado",
      cell: (item) => (
        <Badge variant={item.isActive ? "default" : "secondary"}>{item.isActive ? "Activo" : "Inactivo"}</Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon /> Nuevo usuario
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={users ?? []}
        isLoading={isLoading}
        getRowId={(item) => item.id}
        actions={(item) => {
          const isSelf = item.id === currentUser?.id;
          // Solo un CEO puede tocar a otro CEO (el backend responde 403 a un
          // ADMIN, incluido el reseteo de contraseña): ni se ofrecen las acciones.
          if (item.role === "CEO" && !isCeo(currentRole) ) {
            return <span className="text-xs text-muted-foreground">Solo un CEO</span>;
          }
          return (
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="icon" onClick={() => setEditingUser(item)} title="Editar usuario">
                <PencilIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setResettingUser(item)}
                title="Resetear contraseña"
              >
                <KeyIcon />
              </Button>
              {/* Un usuario no puede activarse/desactivarse a sí mismo desde
                  acá (el backend lo rechaza igual, pero mejor ni ofrecer el
                  botón que dejarlo fallar). */}
              {!isSelf ? (
                item.isActive ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeactivatingUser(item)}
                    title="Desactivar usuario"
                  >
                    <PowerOffIcon />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleActiveMutation.mutate({ id: item.id, isActive: true })}
                    title="Activar usuario"
                  >
                    <PowerIcon />
                  </Button>
                )
              ) : null}
            </div>
          );
        }}
      />

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />

      {editingUser ? (
        <EditUserDialog
          open={!!editingUser}
          onOpenChange={(open) => !open && setEditingUser(null)}
          user={editingUser}
          isSelf={editingUser.id === currentUser?.id}
        />
      ) : null}

      {resettingUser ? (
        <ResetPasswordDialog
          open={!!resettingUser}
          onOpenChange={(open) => !open && setResettingUser(null)}
          user={resettingUser}
        />
      ) : null}

      <AlertDialog open={!!deactivatingUser} onOpenChange={(open) => !open && setDeactivatingUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar a {deactivatingUser?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              No va a poder iniciar sesión hasta que se lo reactive. Si es el único admin activo, el sistema
              va a rechazar esta acción.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={toggleActiveMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (!deactivatingUser) return;
                const id = deactivatingUser.id;
                setDeactivatingUser(null);
                toggleActiveMutation.mutate({ id, isActive: false });
              }}
              disabled={toggleActiveMutation.isPending}
            >
              {toggleActiveMutation.isPending ? "Desactivando..." : "Desactivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
