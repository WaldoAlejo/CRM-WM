# Ubicación, volumen y apilamiento

## Empaque por cartones

Cada línea de recepción puede activar **Registrar cartones**. Se guardan en el
propio ingreso: cartones recibidos, unidades por cartón, máximo de cartones por
pila, confirmación del límite y dimensiones opcionales del cartón. La cantidad
de inventario se calcula como cartones × unidades por cartón. La API rechaza
inconsistencias y contempla estos datos en la protección de reintentos.

El máximo inicial es 3 cartones, **provisional**. Cambiarlo desmarca su
confirmación. Este dato no es el máximo de unidades del producto ni representa
una validación de resistencia de la caja.

Con 35 × 6, 12 × 18 y 50 × 4 se obtienen 626 unidades en 97 cartones. Sus volúmenes
informados de 3,79, 2,15 y 11,33 CBM suman 17,27 m³. A tres cartones por pila se
requieren 12, 4 y 17 bases respectivamente: 33 pilas separadas por ingreso.
Sin largo, ancho y alto no se deducen medidas a partir de los CBM. Las dimensiones
pueden agregarse después desde **Editar ubicación y dimensiones**, conservando
las unidades, los CBM informados, los costos y las dimensiones de la variante.

El resumen de importación planifica lo recibido; no descuenta despachos. En
inventario se muestra una **equivalencia estimada** de cartones si todos los
ingresos positivos de esa variante y ubicación tienen un empaque compatible.
Se asume consolidación de unidades: cartones estimados = techo(stock / unidades
por cartón). Un cartón parcial ocupa una caja completa y el volumen usa el CBM
promedio por cartón informado en esos ingresos. Las equivalencias de cajas
completas/unidades restantes no afirman cuántas cajas siguen físicamente cerradas.
Si hay presentaciones diferentes o entradas sin empaque, no se inventa una
asignación por lote: se indica que deben revisarse los ingresos.

Con dimensiones del cartón se calcula superficie y altura, limitando los
cartones por pila según la altura del nivel de la ubicación. Los CBM derivados
de medidas se muestran separados de los informados por el proveedor. El encaje
de cajas, cargas y pasillos requiere revisión de la distribución física.

## Compatibilidad con registros por unidad

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

`20260923160000_receipt_carton_packaging` añade el campo JSON opcional
`InventoryMovement.packaging`. Los ingresos históricos quedan sin empaque;
no se presume que una unidad equivalga a un cartón. Esta migración depende del
orden normal de las migraciones anteriores, incluida la de volumen.

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
npm test -- --run src/features/importBatches/components/CartonFields.test.tsx src/features/importBatches/components/EditReceiptDialog.test.tsx src/lib/storageVolume.test.ts src/features/warehouses/warehouseLayout.test.tsx src/features/warehouses/spatialWarehouseEditor.test.tsx
```

Validación realizada el 23 de septiembre de 2026, con autorización del usuario:
las pruebas de integración `receiptEditing.test.ts`, `warehouseSpatial.test.ts`,
`warehouses.test.ts` e `inventory.test.ts` pasaron (37 pruebas) en el endpoint
separado de pruebas, esquema `test_integration`. Después se limpiaron sus 33
tablas, conservando el historial de migraciones y los dos contadores iniciales.
La limpieza comprobó que no existieran referencias desde otros esquemas.

Las dos migraciones de volumen y cartones se aplicaron al CRM (`public`).
Se verificaron los tres campos nuevos, ausencia de migraciones pendientes y
conteos idénticos antes/después en las 33 tablas operativas (214 registros).
El cliente Prisma se regeneró, la API local se reinició y `/health` respondió
HTTP 200 con la base conectada. No se borraron datos operativos.
