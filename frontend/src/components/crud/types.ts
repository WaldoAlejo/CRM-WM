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
  // Los 3 de abajo solo hacen falta si esta config se renderiza con
  // CrudTablePage/CrudFormDialog (el formulario genérico de texto/textarea/
  // select con opciones ESTÁTICAS). Un recurso con un campo que necesita
  // datos vivos (ej: un selector de usuarios) usa su propio diálogo hecho a
  // mano — igual que ya hacen Variantes/Consignación — y sigue reusando
  // useCrudResource(config) para list/create/update/delete: por eso el resto
  // de la config (endpoints, columns, permissions) no cambia, solo estos 3.
  formSchema?: ZodType<TFormValues>;
  formFields?: CrudFormFieldConfig<TFormValues>[];
  defaultFormValues?: TFormValues;
  toFormValues?: (item: TItem) => TFormValues;
  permissions?: CrudPermissions;
}
