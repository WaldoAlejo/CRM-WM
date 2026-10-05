import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { MIN_PASSWORD, newPasswordError } from "./passwordRules";

function AuthCard({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent className="grid gap-4">{children}</CardContent>
      </Card>
    </div>
  );
}

const backToLogin = (
  <Link to="/login" className="text-center text-sm text-muted-foreground hover:underline">
    Volver a iniciar sesión
  </Link>
);

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const mutation = useMutation({
    mutationFn: () => apiFetch("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  });

  if (mutation.isSuccess) {
    return (
      <AuthCard title="Revisa tu correo">
        <p className="text-sm">
          Si <span className="font-medium">{email}</span> corresponde a una cuenta activa, te enviamos un enlace para crear una
          contraseña nueva. Vence en 1 hora.
        </p>
        <p className="text-sm text-muted-foreground">
          ¿No llegó? Revisa la carpeta de spam o pide otro enlace en unos minutos. Si ya no tienes acceso a ese correo, pide al
          administrador que actualice tu cuenta.
        </p>
        {backToLogin}
      </AuthCard>
    );
  }

  return (
    <AuthCard title="¿Olvidaste tu contraseña?" description="Escribe el correo con el que ingresas y te enviaremos un enlace.">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="forgot-email">Correo</Label>
          <Input id="forgot-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {mutation.error ? <p className="text-sm font-medium text-destructive">{mutation.error.message}</p> : null}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Enviando..." : "Enviar enlace"}
        </Button>
        {backToLogin}
      </form>
    </AuthCard>
  );
}

export function NewPasswordFields({ password, confirm, onPassword, onConfirm, label = "Contraseña nueva" }: {
  password: string; confirm: string; onPassword(value: string): void; onConfirm(value: string): void; label?: string;
}) {
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="new-password">{label}</Label>
        <Input id="new-password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} value={password} onChange={(e) => onPassword(e.target.value)} />
        <p className="text-xs text-muted-foreground">Al menos {MIN_PASSWORD} caracteres.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm-password">Repite la contraseña</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => onConfirm(e.target.value)} />
      </div>
    </>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const info = useQuery({
    queryKey: ["password-token", token],
    queryFn: () => apiFetch<{ email: string; name: string; purpose: "RESET" | "INVITE" }>("/auth/password-token", { method: "POST", body: JSON.stringify({ token }) }),
    enabled: token.length > 0,
    retry: false,
    staleTime: Infinity,
  });
  const mutation = useMutation({
    mutationFn: () => apiFetch<{ email: string }>("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) }),
    onSuccess: (result) => navigate("/login", { replace: true, state: { email: result.email, notice: "Contraseña guardada. Ya puedes ingresar." } }),
    onError: (error) => setFormError(error.message),
  });

  if (!token || info.isError) {
    return (
      <AuthCard title="Enlace no válido">
        <p className="text-sm">{info.error?.message ?? "El enlace está incompleto. Ábrelo de nuevo desde el correo."}</p>
        <Button asChild>
          <Link to="/forgot-password">Pedir un enlace nuevo</Link>
        </Button>
        {backToLogin}
      </AuthCard>
    );
  }
  if (info.isLoading || !info.data) return <AuthCard title="Verificando enlace…" />;

  const invite = info.data.purpose === "INVITE";
  function submit(e: FormEvent) {
    e.preventDefault();
    const error = newPasswordError(password, confirm);
    setFormError(error);
    if (!error) mutation.mutate();
  }

  return (
    <AuthCard title={invite ? `Bienvenido, ${info.data.name}` : "Crea una contraseña nueva"} description={`Usuario: ${info.data.email}`}>
      <form className="grid gap-4" onSubmit={submit}>
        <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} label={invite ? "Tu contraseña" : "Contraseña nueva"} />
        {formError ? <p className="text-sm font-medium text-destructive">{formError}</p> : null}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Guardando..." : "Guardar contraseña"}
        </Button>
      </form>
    </AuthCard>
  );
}
