export type Role = "ADMIN" | "OPERATOR";

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
