import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// recharts' <ResponsiveContainer> mide el tamaño real del contenedor vía
// ResizeObserver + getBoundingClientRect() para decidir cuánto espacio tiene
// para dibujar — happy-dom no tiene motor de layout real, así que ambos
// reportan 0 y el componente decide que no hay lugar para nada, renderizando
// un <div> vacío sin ningún <svg> adentro (no es un crash, ni un bug de la
// app: es que nunca llega a intentar dibujar). Se stubea acá, una sola vez,
// para que CUALQUIER test futuro que use un gráfico de recharts (no solo
// Reportes) obtenga una medida real y el chart se dibuje de verdad.
//
// Guardado detrás de `typeof HTMLElement !== "undefined"`: algunos archivos
// (ej. src/lib/api.test.ts) fijan `@vitest-environment node` a propósito
// (sin DOM), y este setup corre igual para ellos — sin el guard, referenciar
// HTMLElement/Element ahí revienta el archivo entero antes de que corra un
// solo test.
if (typeof HTMLElement !== "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 400 });
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 800, height: 400, top: 0, left: 0, bottom: 400, right: 800, x: 0, y: 0, toJSON() {} }) as DOMRect;
}

// @testing-library/react solo registra su propio auto-cleanup si detecta un
// `afterEach` GLOBAL (mira `typeof globalThis.afterEach`) — con
// `test.globals: false` en vitest.config.ts, nunca lo encuentra, así que
// NUNCA desmonta un `render()` entre tests. Sin este afterEach explícito,
// cada test que llama render() deja su árbol completo pegado en
// document.body, y el SIGUIENTE test que busca el mismo texto (ej. el
// nombre de una categoría de seed, o "Guardar") encuentra dos+ coincidencias
// y explota por ambigüedad — un bug real, no un defecto de los tests
// puntuales que lo mostraron primero (products.e2e.test.tsx).
afterEach(() => {
  cleanup();
});
