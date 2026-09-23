# Documentos PDF de operaciones

Los botones de descarga están en los detalles de importación, despacho y consignación, las filas de pagos y la cola de cuarentena. Los PDF son copias descargables de los registros al momento de su generación; no se archivan automáticamente en el servidor ni sustituyen documentos tributarios. Descargar no modifica stock, cargos ni pagos. Las fechas y horas se presentan en `America/Guayaquil`.

| Documento | Regla del proceso |
| --- | --- |
| Despacho | Precios finales acordados, total, pagos netos, saldo, condición y vencimiento. Una orden pendiente se identifica como pendiente; una cancelada no solicita pago. |
| Ingreso de bodega | Movimientos reales de recepción, unidades, bodega/ubicación, fecha, CBM y empaque disponible. Hay un consolidado por importación y un PDF por movimiento. |
| Salida de bodega | Movimientos reales de salida del despacho o entrega en consignación. Una liquidación no genera otra salida. |
| Consignación | Mercadería entregada y valor consignado, periodicidad de revisión y plazo de crédito de los cargos. La entrega no crea deuda inmediata. |
| Revisión | Extensión o liquidación, cantidades vendidas/devueltas, cargo generado, vencimiento y saldo actualizado del cargo. |
| Devolución | Unidades recibidas, aceptadas, no conformes y pendientes. Referencia al cargo por no conformes cuando existe. Disponible después de cerrar cuarentena desde la consignación o el despacho original del courier. |
| Reingreso por devolución | Solo movimientos efectivamente creados al aceptar unidades; sin unidades aceptadas la descarga devuelve un mensaje de conflicto. |
| Pago parcial / total | Identifica el pago, importe, método, fechas y saldo después del registro. Reversos/reembolsos y cobros de cero tienen títulos propios. Un exceso se muestra por separado. |

## Importes y privacidad

- Se usa `unitPrice × quantity` con Decimal y la función compartida `computeOrderTotal`; el descuento ya está incluido en el precio y no se aplica de nuevo.
- No se seleccionan ni imprimen costos de fábrica, costos de importación, márgenes, notas internas ni archivos bancarios privados, incluso para descargas de ADMIN/CEO.
- Cada recibo acumula pagos por orden de registro (`createdAt`, con `id` como desempate), no por la fecha declarada del pago. Un pago posterior con fecha retroactiva no convierte un recibo parcial anterior en total. Los recibos no pretenden certificar el saldo actual después de nuevos pagos o reversos.
- Los documentos son vistas de datos vigentes, no instantáneas inmutables: nombres, ubicaciones corregidas y estados pueden variar entre descargas. Conservar el archivo descargado permite guardar la copia emitida en ese momento.
- Todos los endpoints exigen autenticación y responden con `Cache-Control: private, no-store`. Consignaciones y revisiones mantienen el acceso ADMIN/CEO. Los documentos operativos de devolución no publican precios.

## API

Todos son `GET /api/documents/...`, con respuesta `application/pdf`:

- `dispatch-orders/:id`, `dispatch-orders/:id/warehouse-out`
- `dispatch-orders/:id/payments/:paymentId` (valida que el pago pertenezca a la orden)
- `dispatch-orders/:id/return`, `dispatch-orders/:id/return-entry`
- `import-batches/:id`, `movements/:id`
- `consignments/:id`, `consignments/:id/warehouse-out`
- `reviews/:id`
- `returns/:id`, `returns/:id/warehouse-in`

No hay migraciones nuevas ni cambios en las reglas de cobro. Las pruebas cubren importes, privacidad del contenido PDF, paginación, recibos históricos, autorización y documentos antes/después de validar devoluciones.
