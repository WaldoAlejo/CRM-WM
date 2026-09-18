import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "happy-dom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    // Todos los tests son E2E contra el MISMO backend/DB real compartido —
    // correr archivos en paralelo (el default de Vitest) hace que dos
    // archivos puedan generar el mismo dispatchOrder.orderNumber al mismo
    // tiempo (generateOrderNumber cuenta filas, no es un contador atómico
    // — ver el comentario en backend/src/lib/orderNumber.ts) y además
    // agota la memoria disponible en esta máquina al levantar muchas
    // instancias de happy-dom + tráfico de red real a la vez.
    fileParallelism: false,
  },
});
