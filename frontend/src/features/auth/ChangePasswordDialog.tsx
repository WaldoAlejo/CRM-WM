import { useMutation } from "@tanstack/react-query";
import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { NewPasswordFields } from "./PasswordRecoveryPages";
import { newPasswordError } from "./passwordRules";

export function ChangePasswordButton() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => apiFetch("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword: current, newPassword: password }) }),
    onSuccess: () => {
      toast.success("Contraseña actualizada");
      setOpen(false);
    },
    onError: (e) => setError(e.message),
  });

  function openDialog() {
    setCurrent(""); setPassword(""); setConfirm(""); setError(null); mutation.reset();
    setOpen(true);
  }

  return (
    <>
      <Button variant="ghost" size="icon" onClick={openDialog} title="Cambiar mi contraseña" aria-label="Cambiar mi contraseña">
        <KeyRoundIcon />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar mi contraseña</DialogTitle>
            <DialogDescription>Si no recuerdas la actual, cierra sesión y usa «¿Olvidaste tu contraseña?».</DialogDescription>
          </DialogHeader>
          <form
            id="change-password-form"
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const problem = newPasswordError(password, confirm);
              setError(problem);
              if (!problem) mutation.mutate();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="current-password">Contraseña actual</Label>
              <Input id="current-password" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
            {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" form="change-password-form" disabled={mutation.isPending}>
              {mutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
