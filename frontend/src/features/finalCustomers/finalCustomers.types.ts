export type IdType = "CEDULA" | "PASAPORTE" | "RUC";

export interface FinalCustomer {
  id: string;
  fullName: string;
  idType: IdType;
  idNumber: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
}
