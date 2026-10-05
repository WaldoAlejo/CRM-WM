// Misma regla que el backend (auth.schemas.ts / users.schemas.ts).
export const MIN_PASSWORD = 8;

export function newPasswordError(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD) return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
  if (password !== confirm) return "Las contraseñas no coinciden.";
  return null;
}
