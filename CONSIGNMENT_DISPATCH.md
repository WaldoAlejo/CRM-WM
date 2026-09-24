# Consignación desde despachos

En **Nueva orden de despacho**, ADMIN/CEO puede seleccionar **Consignación** para un mayorista. Se usan los mismos productos, precios negociados, ubicaciones y reservas del despacho normal. Se indican los días de crédito para la futura liquidación y el intervalo de revisión (20 días por defecto, de 1 a 90).

- Crear deja la orden pendiente y reserva stock. Todavía no crea lote ni inicia revisiones.
- Confirmar registra una salida `CONSIGNACION` por producto y crea el lote vinculado en la misma transacción. El plazo de revisión comienza en ese momento.
- Cancelar una orden pendiente libera su reserva sin crear lote. Las confirmaciones/cancelaciones concurrentes reclaman la transición de estado antes de modificar inventario.
- La entrega no genera deuda, no admite pagos y no cuenta en ventas ni rentabilidad. Su PDF muestra valor referencial.
- La pantalla Consignación mantiene revisiones, liquidaciones parciales y devoluciones a cuarentena. Cada liquidación conserva el cargo a crédito existente y no vuelve a descontar stock.

Los lotes anteriores permanecen disponibles con su historial y sin despacho de origen. No se reconstruyen entregas históricas ni se modifica su inventario. El enlace antiguo `/consignment/new` redirige al formulario de despachos. El endpoint de creación directa de lotes se conserva por compatibilidad con integraciones anteriores.

## Publicación

Aplicar `backend/prisma/migrations/20260924120000_consignment_dispatch/migration.sql` mediante `npm run prisma:deploy` desde `backend`, generar el cliente con `npm run prisma:generate` y publicar backend y frontend juntos. La migración añade una modalidad, un intervalo y una relación opcional; no borra ni convierte registros existentes.

En Windows, si Prisma no puede reemplazar `query_engine-windows.dll.node` porque está en uso, detener el proceso del backend durante la regeneración y reiniciarlo después.
