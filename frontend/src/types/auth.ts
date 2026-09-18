export type Role = "ADMIN" | "OPERATOR" | "CEO";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}
