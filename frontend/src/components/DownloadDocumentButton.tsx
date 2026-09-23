import { useRef, useState, type ReactNode } from "react";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { apiFetchBlob } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function DownloadDocumentButton({ path, filename, children }: {
  path: string;
  filename: string;
  children: ReactNode;
}) {
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  async function download() {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const blob = await apiFetchBlob(`/documents${path}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${filename.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Give the browser time to start reading the object URL.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo generar el documento");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }
  return <Button type="button" variant="outline" size="sm" disabled={loading} onClick={download} aria-busy={loading}>
    <DownloadIcon className="size-4" />{loading ? "Generando PDF…" : children}
  </Button>;
}
