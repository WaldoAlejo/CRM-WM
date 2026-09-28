import { prisma } from "../lib/prisma";
import { processFiscalDocument } from "../modules/fiscal/documents.service";
import { deliverAuthorizedDocument } from "../modules/fiscal/delivery";

let running = false;
export async function runFiscalQueue() {
    if (running) return;
    running = true;
    try {
      const rows = await prisma.fiscalDocument.findMany({ where: { status: { in: ["QUEUED", "RECEIVED", "WAITING"] }, nextAttemptAt: { lte: new Date() } }, take: 10, orderBy: { nextAttemptAt: "asc" }, select: { id: true } });
      for (const row of rows) await processFiscalDocument(row.id);
      const toMail = await prisma.fiscalDocument.findMany({ where: { status: "AUTHORIZED", cancellationStatus: "NONE", recipientEmail: { not: null }, issuer: { mailProfileId: { not: null } }, deliveries: { none: {} } }, take: 10, select: { id: true } });
      for (const row of toMail) await deliverAuthorizedDocument(row.id);
    } finally { running = false; }
}
export function startFiscalWorker() {
  if (process.env.FISCAL_WORKER_ENABLED === "false") return () => {};
  const run = () => void runFiscalQueue().catch(() => console.error("[facturación] No se pudo completar la consulta de pendientes."));
  const timer = setInterval(run, 5000); timer.unref();
  run();
  return () => clearInterval(timer);
}
