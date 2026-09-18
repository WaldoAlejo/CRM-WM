// Shape real de los listados del backend — no todos paginan (ver
// src/lib/api.ts::normalizeListResponse). Categorías y Mayoristas devuelven
// un array plano; Proveedores/Marcas/Couriers/Clientes devuelven
// { data, pagination }.
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ListResult<T> {
  data: T[];
  pagination: PaginationMeta | null;
}

// Las 2 formas reales en que el backend describe un error (ver
// backend/src/middleware/errorHandler.ts):
// 1. HttpError:  { error: string, field?: string, ...otrosDetails }
// 2. ZodError:   { error: "Datos inválidos", details: { campo: string; mensaje: string }[] }
export interface ApiErrorBody {
  error: string;
  field?: string;
  details?: { campo: string; mensaje: string }[];
}
