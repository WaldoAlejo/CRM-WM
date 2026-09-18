export interface Wholesaler {
  id: string;
  businessName: string;
  ruc: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  creditLimit: string | null; // Decimal serializado por Prisma como string.
  defaultCreditDays: number | null;
  rucValidationStatus: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RucValidationResult {
  found: boolean;
  businessName?: string;
  taxStatus?: string;
  raw: unknown;
}
