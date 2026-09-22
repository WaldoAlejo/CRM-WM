// Ejecución manual de una corrida (sin esperar al cron): útil para probar el
// SMTP real.   npm run reminders:run
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { parseOverdueMaxDays, runDueReminders } from "./dueReminders";

Promise.resolve()
  .then(() => runDueReminders({ repeatDaily: process.env.REMINDER_REPEAT_DAILY === "true", overdueMaxDays: parseOverdueMaxDays() }))
  .then((summary) => console.log("Resultado:", summary))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
