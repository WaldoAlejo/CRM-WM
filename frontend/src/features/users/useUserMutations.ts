import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiFetch } from "@/lib/api";
import type { CreateUserFormValues, EditUserFormValues } from "./users.schema";
import type { AdminUser } from "./users.types";

export function useUserMutations() {
  const queryClient = useQueryClient();

  function invalidateList() {
    queryClient.invalidateQueries({ queryKey: ["users", "list"] });
  }

  const createMutation = useMutation({
    mutationFn: (values: CreateUserFormValues) =>
      apiFetch<AdminUser & { invitation?: { sent: boolean; error?: string } }>("/users", { method: "POST", body: JSON.stringify(values) }),
    onSuccess: (user) => {
      invalidateList();
      if (!user.invitation) toast.success("Usuario creado correctamente");
      else if (user.invitation.sent) toast.success(`Usuario creado. Enviamos a ${user.email} el enlace para crear su contraseña.`);
      else toast.warning(`Usuario creado, pero no se pudo enviar la invitación: ${user.invitation.error}. Reenvíala desde «Resetear contraseña».`, { duration: 10000 });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<EditUserFormValues> }) =>
      apiFetch<AdminUser>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(values) }),
    onSuccess: () => {
      invalidateList();
      toast.success("Usuario actualizado correctamente");
    },
  });

  // Activar/desactivar es el mismo PATCH que la edición general, pero con su
  // propio mutation: así no comparte el estado de isPending/isSuccess del
  // formulario de edición (el toggle de estado vive en un botón de la fila,
  // no en el diálogo de edición).
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch<AdminUser>(`/users/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
    onSuccess: (user) => {
      invalidateList();
      toast.success(user.isActive ? "Usuario activado" : "Usuario desactivado");
    },
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : "No se pudo cambiar el estado. Intenta de nuevo.";
      toast.error(message);
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ temporaryPassword: string }>(`/users/${id}/reset-password`, { method: "POST" }),
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : "No se pudo resetear la contraseña. Intenta de nuevo.";
      toast.error(message);
    },
  });

  const sendAccessLinkMutation = useMutation({
    mutationFn: (id: string) => apiFetch<{ sentTo: string }>(`/users/${id}/send-access-link`, { method: "POST" }),
    onSuccess: ({ sentTo }) => toast.success(`Enlace enviado a ${sentTo}. Vence en 1 hora.`),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "No se pudo enviar el enlace."),
  });

  return { createMutation, updateMutation, toggleActiveMutation, resetPasswordMutation, sendAccessLinkMutation };
}
