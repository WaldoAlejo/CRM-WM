import PDFDocument from "pdfkit";

export interface OperationalDocument {
  title: string;
  reference: string;
  fields: [string, string][];
  columns: string[];
  rows: string[][];
  totals?: [string, string][];
  notices: string[];
}

// This renderer receives only a public document projection, never database records.
export function renderDocumentPdf(document: OperationalDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margin: 42, bufferPages: true,
      info: { Title: document.title, Author: "WM", Subject: document.reference } });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("error", reject);
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    const width = pdf.page.width - 84;
    const bottom = pdf.page.height - 65;
    let y = 42;
    const page = () => { pdf.addPage(); y = 42; };
    const lines = (value: string, available: number) => {
      const result: string[] = [];
      for (const paragraph of value.replace(/[\r\t]/g, " ").split("\n")) {
        let line = "";
        for (const word of paragraph.split(/\s+/)) {
          if (line && pdf.widthOfString(`${line} ${word}`) > available) {
            result.push(line); line = "";
          }
          // Also wrap long identifiers without spaces.
          for (const character of (line ? " " : "") + word) {
            if (line && pdf.widthOfString(line + character) > available) {
              result.push(line); line = "";
            }
            line += character;
          }
        }
        result.push(line);
      }
      return result;
    };
    const paragraph = (value: string, bold = false, size = 10) => {
      pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
      for (const line of lines(value, width)) {
        if (y + size + 5 > bottom) page();
        pdf.text(line, 42, y, { lineBreak: false }); y += size + 5;
      }
      y += 5;
    };
    paragraph("WM | Respaldo de operaciones", true, 11);
    paragraph(document.title, true, 19);
    paragraph(`Referencia: ${document.reference}`, true);
    paragraph(`Generado: ${new Date().toLocaleString("es-EC", { timeZone: "America/Guayaquil" })} (Ecuador)`);
    for (const [label, value] of document.fields) paragraph(`${label}: ${value}`);
    y += 10;
    if (document.columns.length) {
      const firstWidth = document.columns.length > 2 ? width * 0.38 : width / 2;
      const widths = document.columns.map((_, i) => i === 0 ? firstWidth : (width - firstWidth) / (document.columns.length - 1));
      const drawRow = (cells: string[], header = false) => {
        pdf.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(9);
        const wrapped = cells.map((cell, i) => lines(cell, widths[i] - 12));
        const height = Math.max(...wrapped.map(cell => cell.length));
        for (let n = 0; n < height; n++) {
          if (y + 15 > bottom) {
            page();
            if (!header) drawRow(document.columns, true);
            pdf.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(9);
          }
          let x = 42;
          for (let i = 0; i < cells.length; i++) {
            pdf.text(wrapped[i][n] ?? "", x + 6, y, { lineBreak: false }); x += widths[i];
          }
          y += 14;
        }
        pdf.moveTo(42, y + 2).lineTo(42 + width, y + 2).strokeColor("#cccccc").stroke();
        y += 10;
      };
      if (y + 70 > bottom) page();
      drawRow(document.columns, true);
      for (const row of document.rows) drawRow(row);
    }
    y += 12;
    for (const [label, value] of document.totals ?? []) paragraph(`${label}: ${value}`, true);
    for (const notice of document.notices) paragraph(notice);
    paragraph("Copia del registro disponible al momento de generar este documento. No sustituye un comprobante tributario.", false, 9);
    if (y + 65 > bottom) page();
    y += 25;
    paragraph("_________________________                 _________________________");
    paragraph("Entregado / emitido por                                  Recibido por", false, 9);
    const range = pdf.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      pdf.switchToPage(i);
      pdf.font("Helvetica").fontSize(8).fillColor("#555555")
        .text(`WM | Página ${i + 1} de ${range.count}`, 42, pdf.page.height - 35, { lineBreak: false });
    }
    pdf.end();
  });
}
