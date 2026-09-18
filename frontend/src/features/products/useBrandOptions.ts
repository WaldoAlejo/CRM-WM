import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { BrandRef } from "./products.types";

// pageSize alto a propósito: es para llenar un <Select>, no una tabla — con
// el volumen de marcas de este negocio, una sola página alcanza para
// mostrarlas todas sin agregar un segundo mecanismo de paginación acá.
export function useBrandOptions() {
  return useQuery({
    queryKey: ["brands", "options"],
    queryFn: () => apiFetch<{ data: BrandRef[] }>("/brands?pageSize=100").then((res) => res.data),
  });
}
