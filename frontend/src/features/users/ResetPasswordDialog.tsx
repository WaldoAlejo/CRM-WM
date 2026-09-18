import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { AdminUser } from "./users.types";
import { useUserMutations } from "./useUserMutations";

interface ResetPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: AdminUser;
}

// Dos pasos en el mismo diálogo: confirmar, y (recién después de que el
// backend responde) mostrar la contraseña temporal UNA sola vez — no se
// vuelve a poder consultar después de cerrar este diálogo (el backend nunca
// la devuelve de nuevo, ver users.service.ts::resetPassword).
export function ResetPasswordDialog({ open, onOpenChange, user }: ResetPasswordDialogProps) {
  const { resetPasswordMutation } = useUserMutations();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      resetPasswordMutation.reset();
      setCopied(false);
    }
  }, [open]);

  const temporaryPassword = resetPasswordMutation.data?.temporaryPassword;

  async function handleCopy() {
    if (!temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopied(true);
    } catch {
      // Sin clipboard disponible (ej. contexto no seguro): el valor sigue
      // visible y seleccionable a mano en el input, no es un error fatal.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resetear contraseña de {user.name}</DialogTitle>
          {!temporaryPassword ? (
            <DialogDescription>
              Se va a generar una contraseña temporal nueva. La actual dejará de funcionar de inmediato.
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {temporaryPassword ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Contraseña temporal generada — comunicásela a {user.name} por fuera del sistema. No se va a
              volver a mostrar.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={temporaryPassword} className="font-mono" onFocus={(e) => e.target.select()} />
              <Button type="button" variant="outline" size="icon" onClick={handleCopy} title="Copiar">
                {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
              </Button>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          {!temporaryPassword ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={resetPasswordMutation.isPending}
                onClick={() => resetPasswordMutation.mutate(user.id)}
              >
                {resetPasswordMutation.isPending ? "Generando..." : "Resetear contraseña"}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Listo
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
