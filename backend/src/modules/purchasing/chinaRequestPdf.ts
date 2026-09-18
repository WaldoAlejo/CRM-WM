// Arma el PDF de la solicitud al proveedor: imagen, nombre/descripción y
// cantidad pedida. Recibe SOLO líneas ya resueltas por purchasing.service
// (que nunca trae costos) — este archivo ni siquiera conoce esos campos.
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { UPLOADS_ROOT } from "../../lib/upload";
import type { ChinaRequestLine } from "./purchasing.service";

const MARGIN = 40;
const ROW_HEIGHT = 76;
const IMAGE_SIZE = 64;
const TEXT_X = MARGIN + IMAGE_SIZE + 14;
const QTY_WIDTH = 90;

// pdfkit solo embebe JPEG y PNG (no WEBP, que sí se permite subir). Si la
// imagen es WEBP, no existe en disco o no se puede leer, la fila sale con un
// recuadro "Sin imagen" en vez de romper todo el documento.
function resolveImagePath(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  const ext = path.extname(imageUrl).toLowerCase();
  if (![".jpg", ".jpeg", ".png"].includes(ext)) return null;
  const filePath = path.resolve(UPLOADS_ROOT, imageUrl.replace(/^\/uploads\//, ""));
  if (!filePath.startsWith(path.resolve(UPLOADS_ROOT))) return null;
  return fs.existsSync(filePath) ? filePath : null;
}

export function buildChinaRequestPdf(lines: (ChinaRequestLine & { quantity: number })[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, info: { Title: "Solicitud de reposición" } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const contentWidth = doc.page.width - MARGIN * 2;
    const totalUnits = lines.reduce((sum, l) => sum + l.quantity, 0);

    doc.fontSize(18).font("Helvetica-Bold").text("Solicitud de reposición", MARGIN, MARGIN);
    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#555555")
      .text(`Fecha: ${new Date().toLocaleDateString("es-EC")}  ·  ${lines.length} producto(s)  ·  ${totalUnits} unidades`);
    doc.fillColor("#000000");

    let y = doc.y + 16;
    for (const line of lines) {
      if (y + ROW_HEIGHT > doc.page.height - MARGIN) {
        doc.addPage();
        y = MARGIN;
      }

      doc.moveTo(MARGIN, y - 6).lineTo(MARGIN + contentWidth, y - 6).strokeColor("#dddddd").stroke();

      const imagePath = resolveImagePath(line.imageUrl);
      let drewImage = false;
      if (imagePath) {
        try {
          doc.image(imagePath, MARGIN, y, { fit: [IMAGE_SIZE, IMAGE_SIZE] });
          drewImage = true;
        } catch {
          drewImage = false;
        }
      }
      if (!drewImage) {
        doc.rect(MARGIN, y, IMAGE_SIZE, IMAGE_SIZE).strokeColor("#cccccc").stroke();
        doc.fontSize(8).fillColor("#999999").text("Sin imagen", MARGIN, y + IMAGE_SIZE / 2 - 4, {
          width: IMAGE_SIZE,
          align: "center",
        });
        doc.fillColor("#000000");
      }

      const textWidth = contentWidth - (TEXT_X - MARGIN) - QTY_WIDTH;
      const title = line.variantLabel ? `${line.productName} — ${line.variantLabel}` : line.productName;
      doc.fontSize(11).font("Helvetica-Bold").text(title, TEXT_X, y, { width: textWidth, height: 16, ellipsis: true });
      if (line.description) {
        doc.fontSize(9).font("Helvetica").fillColor("#444444").text(line.description, TEXT_X, y + 18, {
          width: textWidth,
          height: IMAGE_SIZE - 18,
          ellipsis: true,
        });
        doc.fillColor("#000000");
      }
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text(`Cant.: ${line.quantity}`, MARGIN + contentWidth - QTY_WIDTH, y + IMAGE_SIZE / 2 - 6, {
          width: QTY_WIDTH,
          align: "right",
        });

      y += ROW_HEIGHT;
    }

    doc.end();
  });
}
