# Integración CRM WM ↔ Kestore

El CRM de WM Global Corp es la fuente de verdad del catálogo, el precio y el
stock de los productos WM que se venden en Kestore (hoy, los perfumes). Kestore
muestra lo que el CRM publica y le avisa al CRM cada pedido pagado, para que el
stock se reserve en el momento y ningún canal venda unidades que ya no existen.

| Dirección | Qué | Cuándo |
| --- | --- | --- |
| CRM → Kestore | Webhook de stock y precio (`POST` a una URL de Kestore) | A los pocos segundos de cualquier cambio |
| Kestore → CRM | Catálogo completo (`GET /catalog`) | Carga inicial y conciliación diaria |
| Kestore → CRM | Pedido pagado (`POST /orders`) | Al confirmarse el pago |
| Kestore → CRM | Estado y anulación de un pedido | Cuando Kestore lo necesite |

**Base del CRM:** `https://crm-wm-production.up.railway.app/api/integrations/kestore`

**Llave entre sistemas:** el **código de Kestore** de cada producto (por
ejemplo `PERKE111` o `FOUR032`). Es el mismo código que ya usa Kestore y está
registrado en cada variante del CRM.

## 1. Autenticación (las dos direcciones)

Es el mismo esquema que Kestore ya usa con el webhook de stock de Siglo 21. La
única diferencia es el nombre de las cabeceras.

- **Secreto compartido:** de 32 caracteres o más, que WM entrega a Kestore por
  un canal privado. En el CRM es `KESTORE_WEBHOOK_SECRET`; en Kestore se guarda,
  por ejemplo, como `Crm__WebhookSecret`.
- **Cabeceras de cada petición:**
  - `X-Crm-Timestamp`: segundos Unix (UTC) en que se firmó la petición.
  - `X-Crm-Signature`: `sha256=` seguido del HMAC-SHA256 en hexadecimal de
    `"{timestamp}.{cuerpo}"`, donde el cuerpo son los bytes exactos que viajan.
    En un `GET` el cuerpo es vacío, así que se firma `"{timestamp}."`.
- **Validez:** se rechaza cualquier petición con más de **5 minutos** de
  diferencia con el reloj del receptor. Así, una petición capturada no se
  puede volver a usar.

Ejemplo en C#, para firmar las peticiones de Kestore al CRM:

```csharp
var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
var body = JsonSerializer.SerializeToUtf8Bytes(pedido);        // vacío ([]) en un GET
var signed = Encoding.UTF8.GetBytes(timestamp + ".").Concat(body).ToArray();
var hash = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), signed);
request.Headers.Add("X-Crm-Timestamp", timestamp);
request.Headers.Add("X-Crm-Signature", "sha256=" + Convert.ToHexString(hash).ToLowerInvariant());
request.Content = new ByteArrayContent(body) { Headers = { ContentType = new("application/json") } };
```

Para verificar el webhook que envía el CRM sirve el mismo código de
`Siglo21WebhookEndpoint`: solo cambian las cabeceras (`X-Crm-Timestamp`,
`X-Crm-Signature`) y el secreto.

Las respuestas del CRM ante un problema de firma o de configuración son:

| Código | Significado |
| --- | --- |
| `401` | Falta la firma, la firma no coincide o la marca de tiempo está vencida |
| `503` | La integración no está habilitada en el CRM |

## 2. Webhook de stock: CRM → Kestore

**Lo implementa Kestore.** Es un endpoint sin sesión, autorizado solo por la
firma, por ejemplo `POST https://<kestore>/crm/webhook/stock`. WM configura esa
URL en el CRM.

El CRM lo llama cada vez que cambia el stock disponible, el precio o la
publicación de un producto. El primer envío incluye todos los productos
publicados; después, solo los que cambiaron.

```http
POST /crm/webhook/stock
Content-Type: application/json
X-Crm-Timestamp: 1793210400
X-Crm-Signature: sha256=4f1c…

{
  "evento": "stock",
  "enviadoEn": "2026-10-29T15:20:00.000Z",
  "items": [
    { "codigo": "PERKE101", "stock": 17, "precio": 45.99, "precioSinIva": 39.99, "activo": true },
    { "codigo": "FOUR013",  "stock": 0,  "precio": 39.00, "precioSinIva": 33.91, "activo": false }
  ]
}
```

| Campo | Significado |
| --- | --- |
| `codigo` | Código de Kestore del producto |
| `stock` | Unidades **disponibles** para vender: el total de todas las bodegas de WM menos lo reservado por despachos pendientes, incluidos los pedidos de Kestore aún no entregados. Nunca es negativo |
| `precio` | Precio de venta a Kestore, **con IVA**. Es el precio que Kestore debe publicar |
| `precioSinIva` | Mismo precio, sin IVA |
| `activo` | `false` cuando WM deja de publicar el producto en Kestore, lo descontinúa o le cambia el código. En ese caso `stock` llega en 0 y el producto debe ocultarse |

**Lo que Kestore debe hacer al recibirlo:**

- Aplicar cada ítem **reemplazando** el valor anterior. No es un incremento:
  si el mismo código llega dos veces, gana el último envío.
- Responder **`2xx`** en cuanto lo haya guardado, por ejemplo
  `{ "ok": true, "actualizados": 2, "desconocidos": 0 }`. Un código que Kestore
  no tenga se cuenta como desconocido, pero no debe hacer fallar el lote.
- Responder en menos de **15 segundos**.

**Si Kestore no responde `2xx`**, el CRM vuelve a intentar con esperas
crecientes, hasta un máximo de 5 minutos entre intentos. Cada reintento envía
el estado más reciente, nunca uno viejo.

Cada envío lleva como máximo 500 ítems. Si hay más, llegan en varios envíos
seguidos.

## 3. Catálogo completo: `GET /catalog`

Devuelve todos los productos que tienen código de Kestore, publicados o no,
con la ficha completa. Sirve para la carga inicial (nombre, descripción, fotos,
medidas) y para una **conciliación diaria**: si algún webhook se perdió,
comparar contra este listado lo corrige.

```http
GET /api/integrations/kestore/catalog
X-Crm-Timestamp: 1793210400
X-Crm-Signature: sha256=…
```

```json
{
  "ok": true,
  "generadoEn": "2026-10-29T15:20:00.000Z",
  "items": [
    {
      "codigo": "FOUR032",
      "sku": "PER-0023-100ML",
      "nombre": "Yara 100mL EDP Women",
      "variante": "100 mL",
      "descripcion": "…",
      "marca": "Lattafa",
      "categoria": "Perfumes",
      "subcategoria": "Mujer",
      "precio": 36.0,
      "precioSinIva": 31.3,
      "ivaPorcentaje": 15,
      "stock": 1,
      "activo": true,
      "pesoKg": 0.5,
      "dimensionesCm": { "largo": 10, "ancho": 7, "alto": 14 },
      "imagenes": ["https://keimage.kestore.com.ec/…jpg"]
    }
  ]
}
```

`stock`, `precio` y `activo` significan lo mismo que en el webhook. Las
`imagenes` son URLs absolutas, con la principal primero.

## 4. Pedido pagado: `POST /orders`

Kestore lo envía **una vez que el pago está confirmado**. El CRM crea un
despacho pendiente para WM, a precio mayorista, y **reserva el stock en ese
instante**. Kestore recibe el nuevo stock disponible en el siguiente webhook.

```http
POST /api/integrations/kestore/orders
Content-Type: application/json
X-Crm-Timestamp: 1793210400
X-Crm-Signature: sha256=…

{
  "pedido": "KE-000123",
  "items": [
    { "codigo": "PERKE101", "cantidad": 2 },
    { "codigo": "FOUR032", "cantidad": 1 }
  ],
  "envio": { "provincia": "Pichincha", "ciudad": "Quito", "direccion": "Av. Amazonas N24-03 y Colón" },
  "cliente": { "nombre": "Ana Pérez", "identificacion": "1712345678", "telefono": "0999999999", "email": "ana@correo.com" },
  "notas": "Entregar en horario de oficina"
}
```

| Campo | Obligatorio | Detalle |
| --- | --- | --- |
| `pedido` | Sí | Número de pedido de Kestore, único. Máximo 60 caracteres |
| `items[].codigo` | Sí | Código de Kestore. Sin repetir dentro del pedido; si hay más de una unidad, se indica en `cantidad` |
| `items[].cantidad` | Sí | Entero mayor que 0 |
| `envio.provincia`, `envio.ciudad` | Sí | Destino de la entrega |
| `envio.direccion`, `cliente.*`, `notas` | No | Se guardan en el despacho para que WM prepare el envío |

El pedido admite de 1 a 100 líneas.

**Respuestas:**

| Código | Cuándo | Cuerpo |
| --- | --- | --- |
| `201` | Pedido registrado | `{ "ok": true, "pedido": "KE-000123", "ordenCrm": "OD-000045", "estado": "PENDIENTE", "fechaDespacho": null }` |
| `200` | El mismo pedido ya se había recibido con el mismo contenido (reintento) | Igual que el `201`, con el estado actual |
| `409` | No hay stock suficiente o un producto no está publicado; no se reserva nada | `{ "error": "No se puede registrar el pedido.", "items": [{ "codigo": "PERKE101", "motivo": "STOCK_INSUFICIENTE", "disponible": 1 }] }` |
| `409` | Ya existe un pedido con ese número pero con otro contenido | `{ "error": "El pedido KE-000123 ya se registró con otro contenido." }` |
| `400` | Datos inválidos | `{ "error": "Datos inválidos", "details": [{ "campo": "items.0.cantidad", "mensaje": "…" }] }` |

Los valores posibles de `motivo` son:

- `NO_EXISTE`: el código no está en el CRM.
- `NO_PUBLICADO`: WM no publica ese producto en Kestore.
- `STOCK_INSUFICIENTE`: no alcanza el stock; el campo `disponible` indica
  cuántas unidades hay.

**Reglas:**

- **Reintentos seguros.** Si se corta la conexión, Kestore puede reenviar
  exactamente el mismo cuerpo: el CRM devuelve el pedido ya creado y no
  reserva dos veces.
- **El pedido es todo o nada.** Si una línea falla, no se reserva ninguna.
- **Un `409` por stock** significa que la unidad se vendió por otro canal entre
  el último webhook y el pago. Kestore debe gestionarlo con el cliente: anular,
  reembolsar u ofrecer un reemplazo. No debe reintentar el mismo pedido.

## 5. Estado y anulación

```http
GET  /api/integrations/kestore/orders/KE-000123
POST /api/integrations/kestore/orders/KE-000123/cancel     (cuerpo vacío)
```

Ambos responden
`{ "ok": true, "pedido": "KE-000123", "ordenCrm": "OD-000045", "estado": "…", "fechaDespacho": … }`.

| `estado` | Significado |
| --- | --- |
| `PENDIENTE` | Recibido; WM aún no lo entrega. El stock está reservado |
| `DESPACHADO` | WM lo entregó al courier. `fechaDespacho` indica cuándo |
| `CANCELADO` | Anulado: el stock reservado volvió a estar disponible |

- **La anulación solo procede mientras el pedido está `PENDIENTE`.** Repetirla
  sobre un pedido ya anulado responde `200`.
- **Un pedido `DESPACHADO` no se anula** (responde `409`). La devolución se
  coordina con WM y se registra en el CRM.
- Un número de pedido que el CRM no conoce responde `404`.

## 6. Qué cambia en Kestore

1. **Endpoint del webhook de stock** (sección 2), siguiendo el modelo de
   `Siglo21WebhookEndpoint`. Para los productos de WM, el stock y el precio
   pasan a venir del CRM y no deben editarse a mano en Kestore.
2. **Envío del pedido al CRM** (sección 4) cuando se confirma el pago de un
   pedido que contenga productos de WM. Solo se envían las líneas de WM; un
   pedido mixto manda únicamente esas líneas.
3. **Anulación** (sección 5) si el pedido se anula antes de la entrega.
4. **Conciliación diaria** con `GET /catalog`: corrige stock, precio y estado
   si algún webhook no llegó.

Para empezar a probar, WM entrega a Kestore el secreto compartido, y Kestore
entrega a WM la URL de su webhook.

## 7. Configuración en el CRM (Railway)

| Variable | Valor |
| --- | --- |
| `KESTORE_WEBHOOK_SECRET` | Secreto compartido (32 caracteres o más). Sin él, todas las rutas de Kestore responden `503` y no se envía nada |
| `KESTORE_WEBHOOK_URL` | URL del webhook de stock de Kestore. Sin ella, el CRM no envía stock, pero las demás rutas funcionan |
| `KESTORE_WHOLESALER_RUC` | RUC del mayorista "Kestore" registrado en el CRM. Los pedidos se registran a su nombre, a crédito, con sus días de crédito por defecto (30 si no tiene configurados) |
| `KESTORE_SYNC_ENABLED` | `false` para pausar el envío de stock sin borrar la configuración |
| `PUBLIC_API_URL` | Opcional: `https://crm-wm-production.up.railway.app`. Base para las fotos subidas al CRM en el catálogo; las fotos con URL externa no la necesitan |

Un producto se publica en Kestore cuando cumple todo esto:

- La variante tiene **código de Kestore** y **precio mayorista**.
- El producto tiene marcada la casilla **Publicar en Kestore**.
- Ni el producto ni la variante están descontinuados ni eliminados.

El precio que recibe Kestore es el precio mayorista del CRM más el IVA del
producto, redondeado al centavo. Como el CRM guarda los precios sin IVA, algunos
precios redondos de Kestore quedan a un centavo; por ejemplo, $35,00 se guarda
como $30,43 sin IVA y vuelve como $34,99.
