// Guarda contra la carrera "afterEach trunca las tablas mientras el test sigue
// corriendo": cuando un test vence por timeout, Vitest lo marca fallido y ejecuta
// el afterEach MIENTRAS el cuerpo continúa. Con este `it`, el cuerpo queda
// registrado y `settleInflight()` (llamado al inicio del afterEach, ANTES de
// truncar) espera a que termine de verdad. Estado por archivo de test (Vitest
// aísla los módulos de cada archivo).
import { it as vitestIt } from "vitest";

let inflight: Promise<unknown> = Promise.resolve();

export const it = (name: string, fn: () => void | Promise<void>, timeout?: number) =>
  vitestIt(
    name,
    () => {
      inflight = Promise.resolve(fn());
      return inflight;
    },
    timeout
  );

// No propaga el error del test (ese ya lo reporta el propio test).
export const settleInflight = () => inflight.catch(() => undefined);
