import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { PaginationMeta } from "@/types/api";
import type { SearchResult } from "./search.types";

export function useSearch(q: string) {
  return useQuery({
    queryKey: ["search", q],
    queryFn: () =>
      apiFetch<{ data: SearchResult[]; pagination: PaginationMeta }>(
        `/search?q=${encodeURIComponent(q)}`
      ),
    enabled: q.trim().length > 0,
  });
}
