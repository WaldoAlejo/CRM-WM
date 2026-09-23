# Ubicación, volumen y apilamiento

En el detalle de cada importación, **Editar ubicación y dimensiones** permite
asignar o corregir la ubicación de un ingreso y actualizar las dimensiones del
empaque y el máximo de unidades por pila de su variante. El límite incluye la
base: `1` significa no apilable. Las dimensiones se expresan como largo × ancho ×
alto en centímetros, por unidad de inventario.

La corrección de ubicación reasigna la cantidad completa del ingreso, conserva
el stock total y deja auditoría con usuario y valores anteriores/nuevos. Se
rechaza si el saldo de la ubicación original, descontando reservas pendientes,
no alcanza. No sustituye a un traslado parcial. Las dimensiones pueden editarse
independientemente incluso después de un despacho.

Los CBM comerciales y los costos históricos de la importación se conservan.
El volumen físico se calcula a partir de las dimensiones actuales de la variante:

- Volumen unitario = largo × ancho × alto / 1.000.000.
- Volumen de existencias = volumen unitario × cantidad actual.
- Unidades por pila = mínimo entre límite del producto y unidades que caben en
  la altura del nivel, si la ubicación tiene plano.
- Superficie mínima estimada = redondear hacia arriba(cantidad / unidades por
  pila) × superficie de una unidad.

La capacidad geométrica de bodega se muestra en m³ y suma las superficies de
almacenamiento seleccionadas por su altura y niveles. Excluye separaciones,
mobiliario y circulación. La superficie por producto es orientativa: no resuelve
el encaje de cajas, la distribución de productos mezclados ni las cargas máximas.
Sin dimensiones se muestra **Sin dimensiones**, nunca un volumen cero supuesto.

## Migración y validación

`20260923120000_storage_volume` añade `Warehouse.capacityCbm` y
`ProductVariant.maxStackUnits` (inicialmente 1). Conserva las posiciones históricas
en `capacity`; un conteo manual antiguo no se convierte automáticamente a m³.
Para planos existentes el volumen se deriva al consultar. Las bodegas sin plano
requieren registrar su capacidad en m³.

Antes de usar el código actualizado, aplicar la migración en el entorno aprobado
y regenerar el cliente Prisma. En Windows, detener el proceso local que tenga
cargada la DLL de Prisma si `prisma generate` devuelve un bloqueo EPERM; reiniciar
la API después. No ejecutar el código nuevo contra un esquema sin migrar.

Verificaciones locales, sin base remota:

```powershell
cd backend
npm run build
npm run typecheck:tests
npm run test:unit
cd ../frontend
npm run build
npm test -- --run src/features/importBatches/components/EditReceiptDialog.test.tsx src/lib/storageVolume.test.ts src/features/warehouses/warehouseLayout.test.tsx src/features/warehouses/spatialWarehouseEditor.test.tsx
```

Las pruebas de integración `receiptEditing.test.ts`, `warehouseSpatial.test.ts`,
`warehouses.test.ts` e `inventory.test.ts` quedan pendientes de autorización para
el esquema remoto de pruebas. Su configuración ejecuta migraciones y limpia los
datos de prueba entre casos; no debe apuntarse a datos operativos.
