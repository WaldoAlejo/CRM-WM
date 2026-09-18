import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import type { Resolver } from "react-hook-form";
import { useForm } from "react-hook-form";
import { applyApiErrorToForm } from "@/components/crud/applyApiErrorToForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { editUserFormSchema } from "./users.schema";
import type { EditUserFormValues } from "./users.schema";
import type { AdminUser } from "./users.types";
import { useUserMutations } from "./useUserMutations";

interface EditUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: AdminUser;
  isSelf: boolean;
}

export function EditUserDialog({ open, onOpenChange, user, isSelf }: EditUserDialogProps) {
  const { updateMutation } = useUserMutations();

  const form = useForm<EditUserFormValues>({
    resolver: zodResolver(editUserFormSchema) as Resolver<EditUserFormValues>,
    defaultValues: { email: user.email, name: user.name, role: user.role },
  });

  useEffect(() => {
    if (open) form.reset({ email: user.email, name: user.name, role: user.role });
  }, [open, user]);

  function handleSubmit(values: EditUserFormValues) {
    // Si es tu propia fila, el rol NI SIQUIERA se manda — el backend rechaza
    // con 400 cualquier PATCH sobre uno mismo que incluya `role` en el body,
    // sin importar si el valor es distinto o no (ver users.service.ts).
    const payload = isSelf ? { email: values.email, name: values.name } : values;

    updateMutation
      .mutateAsync({ id: user.id, values: payload })
      .then(() => onOpenChange(false))
      .catch((error: unknown) => applyApiErrorToForm(error, form));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar usuario</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rol</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={isSelf}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="OPERATOR">Operador</SelectItem>
                      <SelectItem value="ADMIN">Administrador</SelectItem>
                    </SelectContent>
                  </Select>
                  {isSelf ? (
                    <p className="text-sm text-muted-foreground">
                      No podés cambiar tu propio rol — pedile a otro admin que lo haga.
                    </p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Guardando..." : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
