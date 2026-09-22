# Costos de importación en USD

- Costo de referencia de fábrica: `costPriceUSD`. La recepción registra el costo unitario de compra en USD en `unitCost`.
- Cada lote nuevo exige `containerType` (20, 40 o 40HC) y `containerCbm` positivo, indicado por el usuario según la carga contratada.
- Cada línea exige `volumeCbm`: volumen total de todas las unidades de esa línea, no volumen por unidad.
- Los costos del lote son flete + aranceles + otros gastos, sin incluir la compra de productos.

Tarifa por CBM = costos del lote / CBM del contenedor.
Gasto de la línea = tarifa × CBM de la línea.
Gasto unitario = gasto de la línea / cantidad.
Costo real unitario = compra en USD + gasto unitario.

El reparto conserva precisión y se guarda con seis decimales. Se muestra el costo real a centavos. La calculadora aplica 70% sobre ese costo para mayorista y 30% sobre el precio mayorista para PVP; ambos incrementos son editables. Cada precio comercial se redondea a centavos antes de calcular el siguiente.

Ejemplo: 45,000 / 70 × 4.68 / 204 + 18 = 32.747899… → costo real $32.75 → mayorista $55.68 → PVP $72.38.

Las recepciones parciales comparten la tarifa del lote. La suma de CBM recibidos no puede exceder el volumen registrado. El servidor bloquea el lote durante la transacción para validar también recepciones concurrentes. Los reintentos idénticos con la misma clave no duplican stock; cambiar el volumen cambia la identidad de la solicitud.

## Migración y datos anteriores

Aplicar `backend/prisma/migrations/20260922120000_import_cbm_usd/migration.sql` mediante `npm run prisma:deploy` desde backend antes de desplegar el código. Regenerar el cliente con `npm run prisma:generate` y reiniciar el backend.

La columna histórica `costPriceCNY` se conserva, pero queda fuera del cliente Prisma y de las API. No se copian ni convierten esos valores a USD: los costos USD anteriores quedan vacíos hasta ingresar valores confirmados. Los movimientos y sus costos históricos no se recalculan. Para nuevas recepciones de lotes antiguos sin CBM, crear un lote con los datos de volumen; no se inventa el volumen histórico.

Desde la calculadora, “Usar precios mayorista y PVP” completa ambos campos del formulario de variante. “Guardar” persiste ambos; cancelar conserva los precios anteriores.
