// Tareas programadas dentro del propio backend (node-cron, sin infraestructura
// externa). Solo se arranca desde server.ts — createApp() NO lo inicia, así que
// los tests nunca disparan un job real.
import cron from "node-cron";
import { isMailConfigured } from "../lib/mailer";
import { parseOverdueMaxDays, runDueReminders } from "./dueReminders";

// Diario a las 08:00 hora de Ecuador (configurable con REMINDER_CRON / REMINDER_TZ).
const DEFAULT_CRON = "0 8 * * *";
const DEFAULT_TZ = "America/Guayaquil";

let running = false;

export function startScheduler(env: NodeJS.ProcessEnv = process.env) {
  if (env.REMINDERS_ENABLED === "false") {
    console.log("[recordatorios] desactivados (REMINDERS_ENABLED=false).");
    return;
  }

  const expression = env.REMINDER_CRON || DEFAULT_CRON;
  if (!cron.validate(expression)) {
    console.error(`[recordatorios] REMINDER_CRON inválido ("${expression}"): el job NO se programó.`);
    return;
  }
  // Se valida al arrancar: un valor inválido NO deja el job corriendo sin su tope.
  let overdueMaxDays: number | undefined;
  try {
    overdueMaxDays = parseOverdueMaxDays(env);
  } catch (err) {
    console.error(`[recordatorios] ${(err as Error).message} El job NO se programó.`);
    return;
  }
  if (!isMailConfigured(env)) {
    console.warn("[recordatorios] SMTP no configurado (SMTP_HOST/MAIL_FROM): el job corre pero no enviará correos.");
  }

  cron.schedule(
    expression,
    async () => {
      // Sin corridas solapadas (una demorada no se pisa con la siguiente).
      if (running) return;
      running = true;
      try {
        const summary = await runDueReminders({ repeatDaily: env.REMINDER_REPEAT_DAILY === "true", overdueMaxDays });
        console.log("[recordatorios] corrida completa:", summary);
      } catch (err) {
        console.error("[recordatorios] la corrida falló:", err);
      } finally {
        running = false;
      }
    },
    { timezone: env.REMINDER_TZ || DEFAULT_TZ }
  );
  console.log(`[recordatorios] programados: "${expression}" (${env.REMINDER_TZ || DEFAULT_TZ}).`);
}
