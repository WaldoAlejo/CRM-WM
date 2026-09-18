import type { ReactNode } from "react";
import type { FieldValues, Path } from "react-hook-form";
import type { ZodType } from "zod";
import type { Role } from "@/types/auth";

export interface CrudColumn<TItem> {
  header: string;
  cell: (item: TItem) => ReactNode;
  className?: string;
}

export type CrudFieldType = "text" | "textarea" | "select";

export interface CrudFieldOption {
  value: string;
  label: string;
}

export interface CrudFormFieldConfig<TFormValues extends FieldValues> {
  name: Path<TFormValues>;
  label: string;
  type: CrudFieldType;
  placeholder?: string;
  options?: CrudFieldOption[]; // requerido si type === "select"
}

export interface CrudPermissions {
  create?: (role: Role) => boolean;
  update?: (role: Role) => boolean;
  delete?: (role: Role) => boolean;
}

export interface CrudResourceConfig<TItem extends { id: string }, TFormValues extends FieldValues> {
  resourceKey: string;
  title: string;
  singular: string;
  listEndpoint: string;
  createEndpoint?: string;
  updateEndpoint?: (id: string) => string;
  deleteEndpoint?: (id: string) => string;
  columns: CrudColumn<TItem>[];
  formSchema: ZodType<TFormValues>;
  formFields: CrudFormFieldConfig<TFormValues>[];
  defaultFormValues: TFormValues;
  toFormValues?: (item: TItem) => TFormValues;
  permissions?: CrudPermissions;
}
