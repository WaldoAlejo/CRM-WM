# WM / Kestore — Inventario y Almacenamiento

Mini CRM de stock para el negocio de e-commerce WM / Kestore (kestore.com.ec):
control de productos, variantes, categorías, movimientos de inventario y
órdenes de despacho.

## Estructura del proyecto

```
CRM-WM/
  backend/    API REST (Node.js + TypeScript + Prisma + PostgreSQL)
  frontend/   Panel administrativo (React + Vite + TypeScript + Tailwind)
```

## Backend — cómo levantarlo en local

Requisitos: Node.js 18+ y una base de datos PostgreSQL (local, Docker, o un
servicio como Neon/Supabase).

1. Instalar dependencias:
   ```
   cd backend
   npm install
   ```

2. Configurar la conexión a la base de datos:
   ```
   cp .env.example .env
   ```
   Edita `DATABASE_URL` en `.env` con los datos de tu PostgreSQL.

   Si usas un proveedor con connection pooler (ej: Neon), también define
   `DIRECT_URL` con la variante de conexión directa/sin pooler: Prisma
   Migrate la necesita porque el pooler no soporta los advisory locks que usa
   para aplicar migraciones. Si tu Postgres no usa pooler (instalación local,
   Docker), `DIRECT_URL` puede ser idéntica a `DATABASE_URL`.

3. Aplicar las migraciones (crea todas las tablas):
   ```
   npx prisma migrate dev
   ```

4. Cargar datos de ejemplo (3 categorías, 3 productos con variantes y precios,
   un lote de importación con costos reales por variante, una orden de
   despacho de ejemplo con su costo promedio ponderado calculado, y un
   usuario administrador):
   ```
   npx prisma db seed
   ```
   Usuarios de prueba: `admin@kestore.com.ec` / `Admin123!` (rol ADMIN) y
   `operador@kestore.com.ec` / `Operador123!` (rol OPERATOR — útil para
   probar las restricciones de precios/costos). Cámbialos cuando exista la
   pantalla de login real.

   Nota: el seed usa `upsert`/verificaciones para no duplicar categorías,
   productos o variantes al re-ejecutarlo, pero el lote de importación y la
   orden de despacho de ejemplo solo se crean una vez (si ya existen, no se
   vuelven a generar). Si necesitas reiniciar los datos de prueba desde cero,
   borra las tablas de movimientos/órdenes/lotes manualmente o recrea la base.

5. Explorar los datos visualmente (opcional):
   ```
   npx prisma studio
   ```

6. Levantar la API en modo desarrollo (recarga automática al guardar):
   ```
   npm run dev
   ```
   Por defecto queda escuchando en `http://localhost:4000`.

### Endpoints disponibles (Módulo 1: Auth + Categorías/Subcategorías)

- `POST /api/auth/login` — `{ email, password }` → `{ token, user }`. Todas
  las demás rutas requieren `Authorization: Bearer <token>`.
- `GET /api/categories` / `GET /api/categories/:id` — cualquier usuario autenticado.
- `POST /api/categories` / `PATCH /api/categories/:id` / `DELETE /api/categories/:id` — solo rol `ADMIN`.
  El `DELETE` es soft delete y falla con 409 si la categoría tiene productos o subcategorías activas.
- `GET/POST /api/categories/:categoryId/subcategories` — listar/crear subcategorías de una categoría.
- `PATCH /api/subcategories/:id` / `DELETE /api/subcategories/:id` — solo rol `ADMIN`. El `DELETE` falla con 409 si tiene productos activos.
- `GET /api/wholesalers` / `POST /api/wholesalers` — cualquier usuario autenticado (admin u operador). `GET` devuelve un array plano, sin paginación (igual que `/categories`).
- `POST /api/wholesalers/validate-ruc` — `{ ruc }` → `{ found, businessName?, taxStatus?, raw }`. Solo consulta, no crea nada; pensado para el botón "Validar" del formulario de creación. Nunca falla con error: si no hay proveedor configurado o no responde, devuelve `found: false`.
- `PATCH /api/wholesalers/:id` / `DELETE /api/wholesalers/:id` — solo rol `ADMIN`. Al actualizar, NO se vuelve a consultar el RUC contra el proveedor externo (evita gastar una llamada externa y pisar `rucValidationStatus` cuando el usuario solo corrige un teléfono). El `DELETE` es soft delete y bloquea con 409 por 2 motivos independientes, mostrando los que apliquen (no solo el primero):
  1. Hay `DispatchOrder` en `PENDIENTE` de ese mayorista — todavía necesitan al mayorista para completarse (chequeo de crédito al confirmar, etc.), mismo criterio que Category/Brand con productos activos, aplicado a "trabajo en curso" en vez de catálogo.
  2. Tiene `DispatchOrder` `DESPACHADO`, a `CREDITO`, con `paymentStatus` en `PENDIENTE`/`PARCIAL` — deuda real todavía por cobrar (el monto que se muestra es el saldo pendiente real: total de la orden menos `amountPaid`, no el total bruto). Órdenes `DESPACHADO`/`CANCELADO` ya saldadas, o de `CONTADO`/`CONTRA_ENTREGA`, son historial inmutable y no bloquean nada (mismo criterio que `ImportBatch` para `Supplier`).

### Catálogos de referencia: Suppliers, Brands, Couriers, Final Customers

Los 4 siguen el mismo shape (`GET` paginado + detalle abierto a `ADMIN`/`OPERATOR`; `POST`/`PATCH` admin-only salvo que se indique lo contrario; `DELETE` es soft delete):

- `GET /api/suppliers` · `GET /api/suppliers/:id` · `POST /api/suppliers` · `PATCH /api/suppliers/:id` · `DELETE /api/suppliers/:id`. Sin bloqueo por `ImportBatch` dependientes (historial inmutable).
- `GET /api/brands` · `GET /api/brands/:id` · `POST /api/brands` · `PATCH /api/brands/:id` · `DELETE /api/brands/:id`. `DELETE` falla con 409 si hay `Product` activos (`deletedAt: null`) con ese `brandId` — mismo criterio que `Category`.
- `GET /api/couriers` · `GET /api/couriers/:id` · `POST /api/couriers` · `PATCH /api/couriers/:id` · `DELETE /api/couriers/:id`. **Distinto de los otros 3**: `Courier` no tiene `deletedAt` en el schema — reusa el `isActive` que ya existía como su soft delete (`DELETE` pone `isActive=false`). Y a diferencia de `Supplier`/`Brand`/`FinalCustomer`, `Courier.name` sigue siendo un `@unique` normal (no parcial): un nombre reutilizado después de desactivar un courier SÍ choca con 409 (nunca se pidió que fuera de otra forma).
- `GET /api/final-customers` · `GET /api/final-customers/:id` · `POST /api/final-customers` (admin **y** operador, igual que crear una orden) · `PATCH /api/final-customers/:id` (admin-only) · `DELETE /api/final-customers/:id` (admin-only).

**Índices únicos parciales** (`Supplier.name`, `Brand.name`, `FinalCustomer[idType, idNumber]`): a diferencia de un `@unique`/`@@unique` normal de Prisma, la unicidad real en la base solo aplica entre registros `deletedAt: NULL` (`CREATE UNIQUE INDEX ... WHERE "deletedAt" IS NULL`, agregado a mano en la migración porque el DSL de Prisma no soporta `WHERE` en `@unique`). Un registro soft-deleted nunca bloquea crear uno nuevo con el mismo valor — verificado con test explícito por cada uno (soft-delete → recrear con el mismo nombre/cédula → 201, no 409).

### Endpoints disponibles (Módulo 2: Productos y Variantes)

- `GET /api/products` — listado paginado (`page`, `pageSize`), filtros (`categoryId`, `subcategoryId`, `status`, `brandId`) y búsqueda de texto (`q` sobre nombre/sku/modelo). Filas planas, sin variantes anidadas ni precios.
- `GET /api/products/:id` — detalle con variantes, imágenes, certificaciones y adjuntos.
- `POST /api/products` / `PATCH /api/products/:id` / `DELETE /api/products/:id` — admin u operador. `PATCH` valida que la subcategoría pertenezca a la categoría indicada, y exige confirmar `subcategoryId` explícitamente si cambias `categoryId` y el producto ya tenía una asignada. `brandId`, si viene, se valida que exista (404 `"Marca no encontrada"`, mismo criterio que `categoryId`/`subcategoryId` — antes caía a un 409 genérico de violación de FK). `DELETE` es soft delete y falla con 409 si alguna variante tiene stock o stock reservado.
- `POST /api/products/:id/variants` — crea una variante. `sku` y `label` se autogeneran desde `attributes` si no los mandas (`label` nunca es editable directo). Falla con 400 si el producto está `DISCONTINUED` (a menos que mandes `force: true`).
- `PATCH /api/variants/:id` / `DELETE /api/variants/:id` — mismo criterio de bloqueo por stock que productos.
- **Restricción de precios por rol** (`costPriceCNY`, `wholesalePrice`, `wholesaleDiscountPct`, `retailPrice`, `retailDiscountPct`): un `OPERATOR` recibe 403 explícito si intenta escribir cualquiera de estos campos al crear/editar una variante, y **nunca los ve** en las respuestas (ni siquiera como `null`) — se filtran en el service (`serializeVariantForRole`), no en la query a la base de datos.
- `POST /api/products/:id/images` / `POST /api/variants/:id/images` — `multipart/form-data`, campo `image` (JPEG/PNG/WEBP, máx. 5MB). Se guardan en disco local bajo `/uploads` (ver TODO de S3/Cloudinary en `src/lib/upload.ts`).
- `DELETE /api/images/:id` — borra el registro y el archivo, y reordena las posiciones restantes.
- `GET /api/search?q=...` — busca por nombre/sku/modelo/código de barras de producto o variante. Devuelve variantes (la unidad real de inventario) con su stock y ubicación — pensado para el flujo "buscar → despachar". Nunca incluye precios/costos.

### Endpoints disponibles (Módulo 3: Movimientos de Inventario)

- `POST /api/import-batches` — crea un lote de importación. Admin u operador, pero `freightCost`/`customsCost`/`otherCosts` son admin-only (403 explícito para operador, mismo patrón que precios de variante).
- `GET /api/import-batches` — listado paginado, con `movementsCount` (cantidad de líneas de ingreso recibidas) y los 3 campos de costo ocultos (ausentes, no `null`) para operador.
- `GET /api/import-batches/:id` — detalle con todos los `InventoryMovement` de tipo `INGRESO` vinculados; `unitCost` de cada uno oculto para operador.
- `POST /api/import-batches/:id/receive` — registra el ingreso de una o más líneas (`{ variantId, quantity, unitCost, locationId?, notes? }`; `locationId` opcional = ubicación de destino, ver "Bodegas y Ubicaciones"). Todo o nada: si una sola línea referencia un `variantId` inexistente, no se aplica ninguna. `unitCost` sí lo puede cargar operador (es un hecho de la recepción física, no una decisión de precio de venta). Además calcula `landedCostPerUnit` por línea: prorrateo simple, por unidad y en partes iguales, de `freightCost + customsCost + otherCosts` del `ImportBatch` entre TODAS las unidades de ESTE mismo `/receive` (no de todo el historial del lote, si se recibe en varias tandas) — `0` si el lote no tiene ningún costo cargado, nunca `null`.
  - **Idempotencia opcional**: header `Idempotency-Key`. Si se repite la misma key con el mismo body (comparado por un hash sha256 determinístico, sin importar el orden de las líneas), devuelve la respuesta ya guardada sin tocar el stock de nuevo. Si se repite con un body distinto, `422`. Si se repite apuntando a otro lote, `409`. Sin el header, el endpoint funciona igual, sin protección contra reintentos.
- `POST /api/inventory/adjustments` — ajuste manual (**solo ADMIN**: puede ocultar mermas/errores, por eso el rol más restrictivo). `reason` obligatorio, `quantity` con signo. Rechaza con 400 si el resultado dejaría el stock en negativo.
- `GET /api/inventory/movements` — historial paginado, filtros `variantId`/`type`/`importBatchId`/`dateFrom`/`dateTo`. `unitCost` oculto para operador.
- `GET /api/inventory/stock-summary` — stock/reservado/disponible por variante, filtros `categoryId`/`subcategoryId`/`belowMinStock`.

Toda escritura de stock pasa por una única función compartida
(`src/lib/inventoryMovements.ts::applyMovement`), reusada tal cual por el
Módulo 4 (tipo `SALIDA`/`DEVOLUCION`): el incremento de `stock` y el chequeo
de "nunca negativo" son atómicos dentro de la misma transacción que crea el
`InventoryMovement`, sin depender de que cada módulo que la use se acuerde de
repetir esa lógica.

### Endpoints disponibles (Módulo 4: Despachos)

- `POST /api/dispatch-orders` — crea una orden `PENDIENTE` y **reserva** stock (`reservedStock`, nunca `stock`) validando disponibilidad por línea. Cada ítem admite un `locationId` opcional (ubicación de origen): se guarda en `DispatchOrderItem`, se usa como origen de la `SALIDA` al confirmar y se reutiliza como destino de la `DEVOLUCION` si el courier rechaza el envío. Exactamente uno de `wholesalerId`/`finalCustomerId` según `buyerType`. `paymentMethod=CREDITO` es exclusivo de `buyerType=MAYORISTA` (400 explícito para `CLIENTE_FINAL`); `creditDays` se resuelve del body o de `Wholesaler.defaultCreditDays`, pero la fecha real de `dueDate` recién se calcula al confirmar. Rechaza `variantId` repetido entre líneas (con el SKU en el mensaje) y es todo-o-nada entre líneas.
- `POST /api/dispatch-orders/:id/confirm` — transición `PENDIENTE → DESPACHADO`: por ítem, calcula `unitCostSnapshot` (promedio ponderado de todos los `INGRESO` históricos de esa variante) y `landedCostSnapshot` (mismo promedio pero sumando `landedCostPerUnit` de cada `INGRESO`, vía `computeLandedCost`) y los congela, libera `reservedStock`, y aplica `SALIDA`. `landedCostSnapshot` ya es el costo de aterrizaje COMPLETO (fábrica + flete/aduana), no un extra que se sume a `unitCostSnapshot`. Si `paymentMethod=CONTRA_ENTREGA`, crea el `Shipment` en `EN_TRANSITO` en la misma transacción (requiere `courierId`). Rechaza con 409 explícito si la orden no está `PENDIENTE` (cubre tanto doble-confirmación como confirmar una orden cancelada) — nunca duplica la salida de stock.
- `POST /api/dispatch-orders/:id/cancel` — solo si `PENDIENTE`; libera `reservedStock` sin generar ningún movimiento (el stock real nunca salió).
- `GET /api/dispatch-orders` / `GET /api/dispatch-orders/:id` — filtros `status`/`paymentMethod`/`buyerType`/`wholesalerId`/`finalCustomerId`/`shippingProvince`/rango de fechas. `unitCostSnapshot`/`landedCostSnapshot` ocultos para operador en el detalle; `unitPrice`/`discountPct` sí se muestran siempre (son precio de venta, no costo).
- `POST /api/dispatch-orders/:id/payments` — registra un `Payment` (ledger, nunca se edita). `paymentStatus`/`amountPaid` se recalculan siempre sumando todos los `Payment` de la orden; un pago que supera el total se acepta igual (se registra lo real) y el estado se tope en `PAGADO`.
- `GET /api/accounts-receivable` — órdenes `CREDITO` con `dueDate` vencido y no pagadas totalmente.
- `POST /api/shipments/:id/deliver` — `ENTREGADO` + crea el `Payment` del cobro contra entrega automáticamente.
- `POST /api/shipments/:id/reject` — `RECHAZADO` + aplica `DEVOLUCION` por cada ítem (el producto vuelve físicamente a bodega, `stock` sube).
- `POST /api/shipments/:id/lost-or-damaged` — `PERDIDO`/`DANADO` + crea un `InsuranceClaim` con `claimAmount = Σ(unitPrice × quantity)` (precio de VENTA de lo perdido, no el costo — es lo que el courier debe devolver a WM) y `expectedResolutionDate = claimDate + 20 días`. **No genera ningún `InventoryMovement`**: el `SALIDA` de `/confirm` ya sacó esas unidades de `stock` de forma definitiva: crear un `SINIESTRO` acá las restaría dos veces. `MovementType.SINIESTRO` queda reservado para pérdida directa de stock que todavía estaba en bodega (incendio, robo), no para esto.

Todos los endpoints de creación/confirmación/pago/courier están abiertos a
`ADMIN` y `OPERATOR` por igual (son tareas operativas del día a día, no
decisiones de catálogo/costos) — a diferencia de `/inventory/adjustments`
del Módulo 3, que sigue siendo admin-only.

### Endpoints disponibles (extensión Módulo 4: reemplazo/reembolso tras siniestro de courier)

**ADMIN-only**, sin excepción — manejan dinero que el courier debe devolver y decisiones de reembolso/reemplazo al cliente.

- `POST /api/insurance-claims/:id/resolve-customer` — `{ resolution: "REPLACEMENT" }` o `{ resolution: "REFUND", refundAmount }`. 404 si el reclamo no existe; 409 si `customerResolution` ya se registró antes (no se puede resolver dos veces).
  - **REPLACEMENT**: crea una nueva `DispatchOrder` (`PENDIENTE`, `paymentMethod=CONTRA_ENTREGA`, `replacesOrderId` apuntando a la original), con los mismos `variantId`/`quantity`/`priceType`/`discountPct` de cada ítem original. Si la orden original ya está `PAGADO`, los ítems de la nueva orden salen con `unitPrice=0` (el cliente no paga dos veces) — eso hace que `codAmountExpected` salga en `0` automáticamente el día que se confirme esa orden, sin ninguna lógica especial en `/confirm`. Si la original NO está pagada, la nueva orden cobra el monto completo, igual que cualquier venta normal. Reserva stock de la variante en la misma transacción que crea la orden: si no alcanza, 400 explícito y **ninguna** orden ni cambio de `InsuranceClaim` queda persistido (todo o nada). Actualiza `InsuranceClaim.customerResolution = REEMPLAZO`.
  - **REFUND**: crea un `Payment` con `amount` **negativo** en la orden original (`insuranceClaimId` para trazabilidad) y dispara `recalculatePaymentStatus` — `paymentStatus` puede **retroceder** (de `PAGADO` a `PARCIAL` o `PENDIENTE`) si el reembolso baja `amountPaid` por debajo del total; no es un estado que solo avanza. Actualiza `InsuranceClaim.customerResolution = REEMBOLSO`.
  - `claimAmount` (lo que debe el courier) no se recalcula acá — ya quedó fijo al crear el reclamo en `/lost-or-damaged`, independiente de cómo se resuelva la situación con el cliente.
- `PATCH /api/insurance-claims/:id` — `{ status, reimbursedAmount? }`. Actualiza el estado del reclamo ANTE EL COURIER (independiente de `customerResolution`, que es la resolución ante el CLIENTE — dos ciclos de vida en paralelo). `resolvedDate` se llena automáticamente al pasar a `PAGADO`/`RECHAZADO`.
- `GET /api/insurance-claims` — paginado, filtros `courierId`/`status`/`customerResolution`/`overdue=true` (`expectedResolutionDate` vencida y `status` no en `APROBADO`/`PAGADO`/`RECHAZADO`) y `open=true` (en proceso: `PENDIENTE`/`EN_REVISION`, sin exigir que esté vencido; es la definición `OPEN_STATUSES` que también usa el Dashboard). Incluye `pendingByCourier`: suma de `claimAmount` de reclamos abiertos (`PENDIENTE`/`EN_REVISION`) agrupada por courier — **global**, no se filtra por los query params de la lista, es el resumen "de un vistazo" de cuánto debe cada courier.

### Endpoints disponibles (Módulo 5: Reporte de Rentabilidad)

**ADMIN-only**, sin excepción — ambos exponen costo y margen a nivel de línea de producto.

- `GET /api/reports/profitability` — filtros `dateFrom`/`dateTo` (sobre `dispatchDate`), `categoryId`, `variantId`. Devuelve `lines` (por variante: `unitsSold`, `totalRevenue`, `totalCost`, `profit`, `profitMarginPct`) + `totals`, y una sección separada `ventasConReclamoPendiente` con el mismo shape.
  - `totalRevenue` = `Σ(unitPrice × quantity)`. `unitPrice` ya viene **neto** (con descuento aplicado, según la definición original del campo) — nunca se vuelve a aplicar `discountPct`, sería descontar dos veces.
  - `totalCost` = `Σ(costo_unitario × quantity)`, donde `costo_unitario` es `landedCostSnapshot` si existe, o si no `unitCostSnapshot` (órdenes confirmadas antes de que `landedCostSnapshot` existiera: el "extra" de flete/aduana se trata como `0`, nunca se recalcula en vivo para "rellenarlo").
  - Incluye órdenes `DESPACHADO` sin `Shipment`, o con `Shipment` en `EN_TRANSITO`/`ENTREGADO`. Excluye por completo `Shipment.status = RECHAZADO` (el producto volvió a bodega, no hubo venta). Los `PERDIDO`/`DANADO` van a `ventasConReclamoPendiente` mientras su `InsuranceClaim.status` no sea `PAGADO`; en ese momento pasan a `lines`/`totals` como venta normal.
  - **Reproducibilidad**: dos corridas del mismo reporte, sobre el mismo rango de fechas, dan siempre el mismo número — el reporte solo lee snapshots ya congelados en `/confirm`, nunca recalcula costo en vivo (a diferencia de un primer diseño descartado que llamaba a `computeLandedCost` al momento de consultar el reporte).
- `GET /api/reports/profitability/summary` — mismos filtros; agrega `totals` del período, `byCategory` (mismo shape por categoría) y `topProductsByProfit` (top 10 por `profit` descendente). Usa el mismo dataset de `lines` que el reporte principal (no mezcla `ventasConReclamoPendiente`).

### Endpoints disponibles (Módulo 6: Bodegas y Ubicaciones)

- `GET /api/warehouses` (array plano, con sus `locations` activas anidadas) · `GET /api/warehouses/:id` — cualquier usuario autenticado (OPERATOR las necesita para elegir ubicación). `POST`/`PATCH`/`DELETE` — solo ADMIN.
- `GET/POST /api/warehouses/:warehouseId/locations` · `PATCH/DELETE /api/locations/:id` — mismo criterio (lectura abierta, escritura ADMIN). `Location` = `code` libre y editable (único por bodega) + `aisle`/`shelf`/`level` opcionales.
- **Soft delete con `isActive`** (igual que `Courier`, sin `deletedAt`). `DELETE` de bodega falla con 409 si tiene ubicaciones activas; `DELETE` de ubicación falla con 409 si su **stock neto ≠ 0** (agregado del ledger) o si hay ítems de órdenes `PENDIENTE` que la usan como origen. Los movimientos históricos no bloquean.
- **Ledger**: `InventoryMovement` tiene `fromLocationId`/`toLocationId` (ambas nullable — los movimientos anteriores quedan en `NULL`). `applyMovement()` recibe un solo `locationId` y decide el lado por el signo de `quantity` (positivo → destino, negativo → origen). `POST /inventory/adjustments` también acepta `locationId`.
- `GET /api/inventory/stock-by-location` — stock neto por (ubicación, variante) **agregado del ledger** (sin contador paralelo), filtros `warehouseId`/`locationId`/`variantId`, paginado.
- `ProductVariant.warehouseLocation` (texto libre) se conserva tal cual, independiente del nuevo catálogo.

### Endpoints disponibles (Módulo 7: Usuarios) — ADMIN-only, todo el módulo

- `GET /api/users` (activos **e inactivos**, para poder reactivar) · `GET /api/users/:id` · `POST /api/users` (`email`, `password` ≥ 8, `name`, `role`) · `PATCH /api/users/:id` (`name`/`email`/`role`/`isActive`) · `POST /api/users/:id/reset-password`.
- No hay `DELETE`: se desactiva con `isActive=false`. `passwordHash` nunca se selecciona ni se devuelve.
- **Reseteo de contraseña**: genera una temporal aleatoria, la guarda hasheada y la devuelve **una sola vez** en la respuesta (el admin se la comunica por fuera; no hay email ni "forzar cambio en el próximo login").
- **Protecciones** (en `PATCH`): un usuario no puede cambiar su propio `role`/`isActive` (400, aunque el valor no cambie); no se puede desactivar ni degradar al **último ADMIN activo** (409).
- Limitación heredada: el JWT es stateless (8h) — un usuario desactivado o degradado conserva su token hasta que expire.

### Endpoints disponibles (Módulo 8: Dashboard)

- `GET /api/dashboard/summary` — un solo endpoint (los bloques corren en paralelo). Cada bloque reusa la definición de su módulo dueño: `stockAlerts` (`getStockSummary` con `belowMinStock`, top 5 + `count`, usa `ProductVariant.minStock`), `pendingCourierShipments` (`Shipment` en `EN_TRANSITO`), `sales.today|week|month` (líneas `DESPACHADO`, regla compartida `classifySaleByShipment` de `src/lib/dispatchSaleClassification.ts`, la misma de Reportes; "semana" = últimos 7 días, "mes" = mes calendario, en UTC).
- **Por rol**: OPERATOR recibe solo `stockAlerts`, `pendingCourierShipments` y `sales` con `unitsSold`/`totalRevenue`. ADMIN además recibe `accountsReceivable` (`overdueCount`, `totalOutstanding`, mismo `where` que `/accounts-receivable`), `insuranceClaims.pendingCount` y, en cada período de ventas, `totalCost`/`profit`/`profitMarginPct`. Para OPERATOR esas claves están **ausentes** del JSON y la query de ventas ni siquiera selecciona las columnas de costo.

### Validación de RUC (mayoristas)

`Wholesaler` valida su RUC contra un proveedor externo configurable, pero la
integración es opcional por diseño: sin `RUC_VALIDATION_API_URL` en el `.env`,
el registro de mayoristas funciona igual, solo que sin autocompletado. El
código nunca importa un proveedor específico directamente — pasa por la
interfaz `RucValidationService` en
[`backend/src/modules/wholesalers/ruc-validation/`](backend/src/modules/wholesalers/ruc-validation/),
así que cambiar de proveedor (ApiConsult, EcuadorAPI, u otro) es reemplazar
un solo archivo (`httpRucValidationAdapter.ts`) sin tocar el resto del código.
`FinalCustomer` no tiene ninguna integración externa: su cédula/pasaporte se
carga siempre a mano.

## Tests de integración

Corren contra una base de datos **aislada** de la de desarrollo — nunca
contra la de `.env`.

1. Copia `.env.test.example` a `.env.test` y complétalo.
   - Si usas un proveedor con connection pooler (Neon), la forma más simple
     de aislar sin crear infraestructura nueva es reusar la misma base pero
     con un schema de Postgres distinto (parámetro `?schema=` en la URL, ej.
     `test_integration`). Prisma crea ese schema solo si no existe.
   - `TEST_SCHEMA_NAME` debe coincidir exactamente con el `schema=` de las
     URLs. Es una variable separada a propósito: el helper de limpieza entre
     tests (`tests/helpers.ts`) la usa de forma explícita y **nunca** intenta
     adivinar el schema activo con `current_schema()` — sobre una conexión
     con pooler esa función puede responder mal (nos pasó una vez durante el
     desarrollo y truncó por error los datos de `.env`; por eso ahora
     `resetDatabase()` usa la conexión directa, sin pooler, y un nombre de
     schema fijo, nunca inferido).

2. Correr la suite:
   ```
   npm test
   ```
   La primera corrida aplica las migraciones sobre `TEST_SCHEMA_NAME`
   automáticamente (ver `tests/globalSetup.ts`). Cada test limpia la base de
   test en su propio `afterEach`, así que se puede correr repetidamente sin
   arrastrar datos de una corrida a otra.

3. Para aplicar migraciones a mano contra la base de test (por ejemplo justo
   después de crear una branch de Neon nueva, antes de correr la suite por
   primera vez):
   ```
   npm run migrate:test
   ```

### Modo efímero (branch de Neon nueva por corrida, pensado para CI)

Por defecto `npm test` usa la branch/base fija de `.env.test` (cero latencia
extra, cero llamadas a APIs externas). Si además definís `NEON_API_KEY` y
`NEON_PROJECT_ID` en `.env.test` y corrés con:
```
NEON_EPHEMERAL_TEST_BRANCH=true npm test
```
`globalSetup.ts` crea una branch de Neon nueva para esa corrida (heredando
usuario/password de la branch padre), espera a que responda, migra sobre
ella, y la borra al terminar — aislamiento total entre corridas, a cambio de
~10-20s extra. `deleteEphemeralBranch()` se niega a borrar cualquier branch
cuyo nombre no tenga el prefijo `ci-test-` con el que esta misma función
crea las suyas, así que no hay forma de que termine borrando algo que no
haya creado ella misma en esa corrida.

Nota: una branch nueva de Neon es un fork del branch por defecto del
proyecto en ese momento (no una base "en blanco" desde cero), así que puede
heredar migraciones ya aplicadas — por eso igual se corre `migrate deploy`
siempre, como red de seguridad idempotente.

## Infraestructura del servidor

- **Validación de entorno al arrancar** (`src/lib/checkEnv.ts` + `src/server.ts`): antes de levantar la API, se valida que existan `DATABASE_URL` y `JWT_SECRET` (y `CORS_ORIGIN` si `NODE_ENV=production`). Si falta alguna, se imprime en un solo mensaje TODAS las que faltan (no solo la primera) y el proceso hace `process.exit(1)` — nunca queda "escuchando" con configuración incompleta. El `import("./app")` que arma el servidor es **diferido a propósito** (dynamic import, no un `import` estático al tope del archivo): `./app` carga transitivamente a `@prisma/client`, que autocarga su PROPIO `.env` al inicializarse — si esa carga pasara antes del chequeo, repoblaría `DATABASE_URL` por su cuenta y el chequeo nunca se dispararía en un entorno con un `.env` real presente.
- **CORS** (`src/lib/corsOptions.ts`): `CORS_ORIGIN` acepta una lista de orígenes separados por coma. Sin definirla, en desarrollo cae al modo abierto de siempre (refleja cualquier `Origin`); en producción es obligatoria (ver validación de arriba).
- **`GET /health`**: hace un `SELECT 1` real contra la base (no solo "el proceso está vivo") — `200 { status: "ok", db: "connected" }` o `503 { status: "error", db: "disconnected" }`.

## Modelo de datos

El esquema completo vive en [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma),
con comentarios explicando el porqué de cada decisión de diseño (atributos de
variante en JSON, ledger de movimientos de inventario, soft delete, auditoría).

## Frontend

React 19 + Vite + TypeScript + Tailwind, con React Query, React Hook Form + Zod
y Recharts (gráficos). Se levanta con `cd frontend && npm install && npm run dev`
(necesita el backend en `http://localhost:4000`).

### Páginas

| Ruta | Página | Acceso |
|---|---|---|
| `/` | Dashboard (alertas de stock bajo, envíos esperando al courier, ventas hoy/7 días/mes; ADMIN: cartera vencida, reclamos en proceso y ganancia) | todos (widgets de costo solo ADMIN) |
| `/products`, `/products/:id`, `/search` | Productos, variantes, imágenes, búsqueda | todos (precios/costos ocultos a OPERATOR) |
| `/inventory`, `/inventory/low-stock` | Stock por ubicación; stock bajo | todos |
| `/import-batches`, `/new`, `/:id`, `/:id/receive` | Importaciones: listado, nuevo lote con **vista previa en vivo del prorrateo por unidad** (solo ADMIN), detalle, recepción de más mercadería por tandas, `locationId` por línea | todos (costos del lote y costo puesto solo ADMIN; OPERATOR sí carga el costo unitario en origen porque el backend lo exige) |
| `/dispatch-orders`, `/new`, `/:id` | Despachos (con selector de ubicación por ítem), pagos, courier | todos |
| `/catalog/*` | Categorías, marcas, proveedores, couriers, mayoristas, clientes, bodegas (`/catalog/warehouses`) y sus ubicaciones | lectura todos, escritura ADMIN |
| `/accounts-receivable`, `/insurance-claims`, `/reports*`, `/admin/users` | Cartera, reclamos de seguro (`?open=true`), rentabilidad, usuarios | solo ADMIN (`RequireRole` + oculto en el menú) |

Patrones: catálogos simples usan el CRUD genérico (`components/crud/`); las
páginas con acciones propias (Usuarios, Importaciones) usan `DataTable` con
hooks a medida. Los widgets restringidos por rol **no se renderizan** para
OPERATOR (no se muestra "$0" ni un placeholder).

### Tests end-to-end

Los tests del frontend corren contra el **backend real** (sin mocks) y contra
la base de **desarrollo**, no una aislada:

```
cd backend && npm run dev      # terminal 1 (necesita el seed: admin@ / operador@kestore.com.ec)
cd frontend && npm test        # terminal 2
```

Reglas para escribir tests nuevos (aprendidas de fallas reales):
- La base es compartida y **acumula datos**: los pedidos/ledger no se pueden borrar por API. No asumas que tu fixture cae en la página 1 de un listado — filtra por tus propios datos (proveedor, bodega) o recorre las páginas.
- Un `<Select>` de Radix recién usado deja capas abiertas en happy-dom que impiden abrir un buscador (`Combobox`/Popover) después: usa primero el buscador y luego los selects.
- Cualquier página que use `<Link>` necesita `MemoryRouter` en su test.
- `dueDate` de crédito no se puede fijar en el pasado por API: los tests de cartera lo retroceden con un script Node que usa el `PrismaClient` del backend.
