import "dotenv/config";
import { runFiscalQueue } from "./fiscalWorker";
import { prisma } from "../lib/prisma";

runFiscalQueue().catch(() => { console.error("No se pudo procesar la cola fiscal."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
