# Importaciones y precios negociados

Todos los costos y precios están expresados en USD. Cada lote exige un tipo (20, 40, 40HC o LCL) y su volumen contratado. LCL usa solamente los CBM propios, por ejemplo 26 CBM de power stations.

Los gastos del lote son flete + aranceles + otros gastos, sin incluir la compra de productos. Tarifa por CBM = gastos / CBM contratados. Gasto unitario de cada línea = tarifa × CBM de esa línea / cantidad. El costo real incluye compra y gasto unitario.

La importación registra costos y stock; no fija porcentajes ni precios de venta. La recepción actualiza costPriceUSD y conserva referencias anteriores, sin usarlas para negociar despachos.

## Costos en productos y variantes

Las listas de productos y variantes y el formulario de variante muestran el
costo real promedio ponderado en USD, incluyendo los gastos de importación:
`suma(cantidad recibida × (costo de origen + gasto unitario)) / suma(cantidad recibida)`.
Se usan los ingresos históricos con costo registrado, como en la negociación
de despachos; no el stock restante ni el último costo de fábrica.

En productos se ponderan todas las unidades recibidas de sus variantes no
eliminadas, sin promediar los promedios de las variantes. Sin ingresos con costo
se muestra `—` en las listas y pendiente en el formulario. Un costo registrado
de cero se muestra como `$0.00`. Los campos calculados solo se exponen a ADMIN/CEO.
El costo de fábrica se conserva como dato de origen, pero no se muestra como
costo del catálogo. Esta visualización no requiere migración de base de datos.

## Despacho

ADMIN/CEO pueden consultar el costo real promedio ponderado de las recepciones y escribir un incremento por línea, sin porcentaje predeterminado. Tanto mayoristas como clientes finales se calculan directamente sobre ese costo: precio = costo real × (1 + porcentaje / 100). 100% duplica el costo; 120% lo multiplica por 2.20. No es margen sobre ventas ni descuento.

Se redondean costo y precio a centavos. Con costo $32.75: 70% = $55.68; 80% = $58.95; 90% = $62.23; 100% = $65.50; 120% = $72.05.

El servidor calcula el precio y guarda markupPct, landedCostSnapshot, unitCostSnapshot y unitPrice asociados al comprador en la misma transacción que la reserva. El costo acordado queda congelado al crear el despacho y no cambia al confirmarlo ni por importaciones posteriores. Si cambia el costo desde la vista previa, se exige revisar la negociación. El precio enviado por el cliente no reemplaza al cálculo cuando se proporciona markupPct.

Los permisos de costos se mantienen: OPERATOR no puede consultar o escribir porcentajes sobre costo ni leer esos porcentajes, pues permitirían deducir el costo. El flujo operativo con precios netos manuales sigue siendo compatible, igual que las ventas históricas. No se combina un incremento negociado con descuento adicional.

## Ganancia

El detalle del despacho muestra porcentaje, costo congelado y ganancia por línea. Rentabilidad agrupa ventas confirmadas por mayorista o cliente final, con ventas, costo, ganancia y margen sobre ventas. Los filtros de fechas y reglas existentes para entregas/reclamos siguen aplicando. La ganancia es venta menos costo de mercadería importada; no representa utilidad neta después de todos los gastos operativos del negocio.

## Migraciones

Aplicar npm run prisma:deploy desde backend y regenerar Prisma antes de reiniciar. Las migraciones 20260922120000_import_cbm_usd, 20260922130000_import_lcl y 20260922140000_dispatch_negotiated_markup son aditivas. Los costos CNY históricos se conservan sin conversión automática. Las ventas anteriores no se recalculan ni se les inventa un porcentaje negociado.
