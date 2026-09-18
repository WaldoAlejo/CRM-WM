import type { Certification, ProductAttachment } from "../products.types";

interface ProductReadonlySectionProps {
  certifications: Certification[];
  attachments: ProductAttachment[];
}

// No hay endpoint para crear/editar certificaciones ni adjuntos todavía
// (products.service.ts los incluye en el GET, pero no existe ningún POST) —
// por eso esta sección es de solo lectura, y por eso mismo NO se renderiza
// en absoluto si ambos arrays vienen vacíos: una sección vacía sin forma de
// llenarla es ruido, no información.
export function ProductReadonlySection({ certifications, attachments }: ProductReadonlySectionProps) {
  if (certifications.length === 0 && attachments.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">Certificaciones / Adjuntos</h2>
      <ul className="space-y-1 text-sm">
        {certifications.map((cert) => (
          <li key={cert.id}>
            <span className="font-medium">{cert.type}</span>
            {cert.certNumber ? ` — ${cert.certNumber}` : ""}
            {cert.fileUrl ? (
              <a href={cert.fileUrl} target="_blank" rel="noreferrer" className="ml-2 text-primary hover:underline">
                Ver archivo
              </a>
            ) : null}
          </li>
        ))}
        {attachments.map((attachment) => (
          <li key={attachment.id}>
            <span className="font-medium">{attachment.type}</span>
            <a href={attachment.url} target="_blank" rel="noreferrer" className="ml-2 text-primary hover:underline">
              Ver archivo
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
