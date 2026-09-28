# Configuración e integración de facturación electrónica

Estado: implementación local de configuración, comprobantes y conexión SRI.
Producción desactivada; falta certificación práctica con la firma real del emisor.
Fecha de revisión: 2026-09-24.

## Operación implementada

- Configuración de correo y empresas accesible para ADMIN/CEO; P12 y contraseñas
  cifrados, validación de clave privada y vigencia, reemplazo atómico e historial.
- Una empresa activa. Los nuevos despachos congelan emisor, ambiente e IVA por
  línea. Los precios de venta son **sin IVA**, según confirmación del usuario.
- Facturas en borrador al confirmar contado/crédito, al registrar aceptación en
  contra entrega y al liquidar unidades vendidas en consignación. El mayorista
  vende con su propio RUC, según confirmación del usuario.
- El administrador revisa datos y medio de pago y pulsa **Emitir**. Se asigna
  numeración, valida el XML con XSD oficiales, firma XAdES y transmite inmediatamente.
  Los borradores todavía no son comprobantes emitidos: deben revisarse en el
  momento de la venta, no acumularse para otro día.
- Cola persistente, consulta previa al reintento, conservación de clave y número,
  XML autorizado, PDF y entrega por correo. Las fallas de correo quedan registradas.
- Notas de crédito por cantidades, con reserva de unidades entre notas pendientes
  y ajuste del saldo por cobrar únicamente al obtener autorización. No reingresan
  inventario: la recepción/inspección sigue por el flujo de devoluciones.
- Guías preparadas antes del despacho, con transportista, placa, direcciones y fechas.
- Registro auditado de trámites de anulación realizados en el portal del SRI;
  la aplicación no afirma haber solicitado automáticamente una anulación.

Configuración inicial: crear cuenta de correo, empresa, series 01/04/06 y cargar
la firma; configurar IVA de productos y activar el emisor. Los pedidos históricos
sin emisor no se refacturan ni reciben IVA retroactivamente. La clave local de
cifrado se configura en `.env`, sin incorporarla a Git; ver `DEPLOYMENT.md` para
instalaciones nuevas y ejecución de la cola en Railway.

Límites de esta entrega: el cierre de consignación sigue siendo una liquidación
operada por el administrador y debe realizarse mensualmente; no se infieren ventas
no reportadas. La revisión comercial cada 20 días no reemplaza ese cierre.
Los anticipos sobre pedidos pendientes con emisor se bloquean hasta implementar
su tratamiento fiscal específico. Reposiciones e indemnizaciones no generan una
factura de venta automática. No se ha hecho una emisión real al SRI, cargado una
firma de cliente ni enviado correos reales durante las pruebas.

## Decisión del negocio

Se usará **una sola empresa emisora activa**. Las empresas anteriores y sus
comprobantes conservarán su historial. Cambiar de firma no cambia la empresa;
cambiar de RUC crea otra empresa emisora. Ninguna de esas operaciones modifica
documentos emitidos anteriormente.

La configuración permitirá cambiar de emisor sin modificar código. La empresa
seleccionada debe ser la que efectivamente realiza la venta y estar habilitada
para emitir. Cambiar la configuración no transfiere inventario, contratos,
cuentas por cobrar ni obligaciones tributarias entre empresas.

## Navegación y permisos

- Configuración → Correo.
- Configuración → Facturación electrónica: empresas, datos fiscales, puntos de
  emisión, firma y validación de preparación.
- Facturación → Comprobantes: listado, detalle, documentos relacionados e
  historial de eventos.

Administración de configuración: ADMIN y CEO, respetando la jerarquía existente.
Los operadores de bodega no acceden a credenciales ni a la configuración fiscal.
Cada despacho muestra los comprobantes asociados según los permisos del usuario.

## Correo

Configurar nombre y dirección del remitente, dirección de respuesta opcional,
servidor SMTP, puerto, modalidad TLS, usuario y contraseña o contraseña de
aplicación según el proveedor. Los proveedores que exijan OAuth requerirán el
adaptador de autenticación correspondiente; no se promete compatibilidad por
usuario y contraseña con todos los proveedores.

Acciones: guardar, verificar conexión y enviar una prueba a una dirección
elegida explícitamente por el administrador. Verificar conexión no envía correo.
Ninguna prueba debe enviar mensajes a clientes de forma automática.

Mantener un remitente general para comunicaciones comerciales. Cada empresa
emisora puede asociar su propio perfil de correo para comprobantes. Un cambio de
empresa no debe enviar facturas nuevas con la identidad de la empresa anterior.

Las contraseñas no se devuelven al navegador. Un campo vacío al editar conserva
la contraseña existente; su eliminación es una acción explícita. Cifrado en
reposo con una clave del servidor separada de la base de datos, acceso restringido
y exclusión de secretos en registros de auditoría y errores.

El backend actualmente utiliza `src/lib/mailer.ts` con variables de entorno y
recordatorios en `src/jobs/dueReminders.ts`. La integración debe reutilizar esa
puerta de envío, incorporar lectura de configuración persistida y evitar que su
caché mantenga credenciales antiguas. Conservar compatibilidad con la
configuración existente hasta que el administrador active la nueva.

Los envíos deben tener destinatario, fecha, intentos y resultado consultables.
Un envío aceptado por SMTP no demuestra recepción en la bandeja del destinatario.
Reintentar o reenviar correo nunca crea otro comprobante.

## Empresa emisora

Datos configurables:

- RUC, razón social, nombre comercial y logo opcional.
- Dirección de matriz y direcciones de establecimientos.
- Establecimientos y puntos de emisión.
- Obligación de llevar contabilidad y demás condiciones fiscales aplicables:
  régimen, contribuyente especial, agente de retención y resoluciones pertinentes.
- Ambiente de pruebas o producción.
- Perfil de correo utilizado para entregar comprobantes.
- Secuencia inicial al incorporar cada serie, considerando documentos emitidos
  anteriormente fuera de la aplicación.

La numeración se administra por empresa, ambiente, tipo de comprobante,
establecimiento y punto de emisión, con asignación atómica. Después de utilizar
una serie no se permite reiniciarla ni retrocederla desde un formulario.

Activar una empresa nueva será una operación transaccional y auditada que
desactive la anterior. Una sola referencia al emisor activo evita dos emisores
activos por solicitudes concurrentes. La activación requiere configuración
completa; el paso a producción exige comprobar preparación fiscal y técnica.

Los pedidos deben tener explícito el emisor antes del evento fiscal. Cambiar el
emisor predeterminado aplica a operaciones nuevas. Los documentos en proceso,
reintentos, cobros y correcciones permanecen asociados a su empresa original.
Los pedidos pendientes de la empresa anterior requieren resolución explícita;
no se reasignan silenciosamente ni se convierte todo el historial en facturas.

## Firma electrónica

El administrador podrá cargar un archivo `.p12`/`.pfx` y su contraseña. Antes de
activarlo se valida su lectura, presencia de clave privada y certificado
correspondiente, vigencia, capacidad de firma y adecuación del titular o
representante al emisor. Validar el contenedor no acredita por sí solo autorización
tributaria: también debe verificarse la habilitación del emisor.

Mostrar únicamente metadatos: titular, entidad certificadora, número de serie,
huella, fechas de vigencia y estado. Alertar antes del vencimiento.

Acción **Reemplazar firma**: cargar, validar y activar la nueva versión
atómicamente. Una contraseña incorrecta o un certificado inválido no elimina la
firma vigente. Los nuevos documentos usan la nueva firma; los ya firmados
conservan sus XML y firma originales. La trazabilidad guarda la versión usada.
No es necesario conservar claves privadas antiguas indefinidamente para verificar
documentos históricos; deben existir políticas de retención y retiro.

El archivo y la contraseña se cifran con acceso exclusivo del backend. Nunca
se guardan en `/uploads`, que en esta aplicación es público, ni se ofrecen para
descarga desde la interfaz. No se solicita subir secretos a una conversación.

Las correcciones que requieran firma de una empresa anterior necesitan una
credencial vigente y habilitada para esa empresa. La firma de la nueva empresa
no reemplaza esa capacidad. Mantener soporte para obligaciones históricas no
significa habilitar dos empresas para nuevas ventas.

## Registro de comprobantes

Tipos iniciales: factura, nota de crédito y guía de remisión. Otros documentos
del SRI se incorporarán con sus propias reglas; la liquidación interna de
consignación no es una liquidación de compra del SRI.

Filtros: empresa, ambiente, tipo, estado fiscal, rango de fechas, cliente o
mayorista, número de comprobante y despacho. Pruebas y producción deben ser
claramente distinguibles en pantalla y exportaciones.

Columnas: fecha, empresa/RUC, tipo, número, destinatario, importe cuando aplique,
despacho, estado fiscal y estado del correo.

Detalle: datos históricos del emisor y comprador, líneas e impuestos, clave de
acceso, autorización y fechas, respuesta del SRI, XML autorizado, RIDE,
documento original y notas de crédito relacionadas, auditoría y entregas por correo.

Estados separados:

- Preparación: borrador y pendiente de emisión.
- Proceso fiscal: generado, firmado, pendiente de transmisión, recibido/en
  procesamiento, autorizado, devuelto/no autorizado, según respuesta real.
- Anulación: no solicitada, solicitada, confirmada o rechazada.
- Correo: pendiente, enviado al servidor o fallido.

Una factura con nota de crédito parcial sigue siendo una factura autorizada;
se muestra el ajuste relacionado. No se la marca automáticamente como anulada.
Solicitar anulación tampoco equivale a confirmación del SRI. No se ofrecerá una
acción local que simule anular fiscalmente o borrar comprobantes.

Las acciones dependen del estado y del soporte oficial disponible: descargar,
consultar autorización, reenviar correo y crear correcciones permitidas. Cuando
un trámite requiera el portal del SRI, se registra y concilia su resultado; no
se presupone que exista un servicio público de anulación equivalente al de emisión.

## Eventos de emisión

- Crear un pedido o reservar inventario no emite factura automáticamente.
- Contado y crédito: aplicar el hecho generador correspondiente. No esperar
  el pago total de una venta a crédito. Los anticipos requieren tratamiento
  fiscal y conciliación para no duplicar la venta.
- Contra entrega: distinguir salida de bodega, aceptación/entrega al comprador
  y depósito del courier. La regla precisa depende de cuándo se perfecciona la
  venta; nunca depende del depósito tardío del courier.
- Consignación auténtica: documentar el traslado y liquidar mensualmente las
  ventas al consignatario, bajo el supuesto de que revende con su propio RUC.
  La revisión comercial cada 20 días no sustituye el cierre fiscal mensual.
  Revisar la excepción de productos sujetos a ICE cuando corresponda.
- Devolución: conciliar inventario, deuda y corrección tributaria por separado.
  No emitir nota de crédito por mercadería consignada que nunca se facturó.

El punto existente `CONSIGNACION_LIQUIDACION` es un enlace adecuado para la
factura de unidades vendidas; no se genera una segunda salida de inventario.

Configuración comercial no significa poder postergar libremente el evento
tributario. El usuario confirmó aceptación al recibir para contra entrega,
reventa con RUC propio para consignación y precios sin IVA. La emisión requiere
revisión del administrador; no se elige automáticamente un medio de pago fiscal.

## Integración y consistencia

Usar los servicios oficiales de recepción y autorización, XML validado contra
los esquemas publicados y firma electrónica compatible con el SRI. No almacenar
la clave del portal SRI si el servicio de emisión no la requiere.

Un documento tendrá datos inmutables de emisor, destinatario, precios,
descuentos e impuestos al emitirse. Las tarifas y condiciones fiscales se
versionan; editar productos o configuración no cambia documentos históricos.

Registrar el evento fiscal y el trabajo de envío en la misma transacción local.
Transmitir inmediatamente con una cola persistente, reintentos y alertas.
Ante un timeout, consultar el estado y reutilizar la identidad del comprobante;
no asignar un número nuevo para resolver una incertidumbre de red.

Una falla del SRI debe quedar visible y tener recuperación. Una falla de correo
no revierte la autorización. Enviar al comprador el XML autorizado y su RIDE
conforme al circuito definido, manteniendo evidencia de los intentos.

### Conformidad con la ficha técnica offline 2.34 (revisión 2026-09-28)

- Firma XAdES-BES: `QualifyingProperties@Target` apunta al Id de la firma y el
  XML firmado conserva la declaración `<?xml version="1.0" encoding="UTF-8"?>`.
- Autorización: `RECHAZADO` y `NO AUTORIZADO` se tratan como rechazo.
- Error 70: un comprobante recibido no se reenvía mientras el SRI lo procesa;
  solo se consulta autorización con espera creciente
  (`FISCAL_AUTHORIZATION_WAIT_SECONDS`, tope 15 min). Tras 24 h sin respuesta se
  reenvía la misma clave.
- Error 82: la guía no se emite si el inicio del traslado es anterior a su fecha
  de emisión; las fechas pueden corregirse en el borrador.
- RIMPE negocio popular queda bloqueado: los XSD 1.1.0 oficiales solo aceptan la
  leyenda de RIMPE emprendedor. Agente de retención y contribuyente especial
  aceptan solo el número de resolución.
- Error 52: el IVA de cada línea y el de cada tarifa en `totalConImpuestos` se
  calculan como base × tarifa redondeada a 2 decimales (el del grupo sobre la
  suma de bases, no sumando líneas redondeadas). La cuenta por cobrar
  (`computeOrderTotal`) usa la misma fórmula que el `importeTotal`.
- Error 45: al corregir un rechazo por secuencial registrado se libera número y
  clave (el SRI no guarda comprobantes devueltos) y se asigna un número nuevo al
  emitir. La serie puede avanzarse, nunca retroceder, desde Configuración.
- Comprador: RUC (13 dígitos), cédula (10) y pasaporte (3–20 alfanuméricos) se
  exigen por formato; el dígito verificador solo genera advertencia, porque el
  SRI responde con advertencias 59/62 y hay RUC recientes fuera del algoritmo.

## Entrega y validación previstas

1. Configuración de correo y emisores, permisos, cifrado, firma reemplazable e
   historial de cambios.
2. Modelos fiscales, registro de comprobantes y enlace con despachos.
3. Generación, firma, recepción, autorización, RIDE y envío, en ambiente de pruebas.
4. Facturas por modalidad, guías y notas de crédito; manejo de devoluciones y
   correcciones históricas.
5. Validación contable de reglas y activación de producción.

Casos de aceptación esenciales: permisos de operador, secretos ausentes en
respuestas y logs, reemplazo fallido conserva firma previa, vencimiento de firma,
activación concurrente de empresas, conservación de RUC y series históricas,
reintento sin doble factura, nota de crédito parcial, cambio de empresa con
documentos pendientes, fallo de correo después de autorización y cierre mensual
de consignación. Las pruebas automáticas no envían correos reales ni emiten
comprobantes de producción.

## Fuentes oficiales consultadas

- [SRI: facturación electrónica, requisitos y ficha técnica 2.34](https://www.sri.gob.ec/facturacion-electronica).
- [LRTI, artículo 61](https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/96275c4b-daf2-456d-b907-7ed1a029dc3f/LRTI_ultima_actualizacion_11012024.pdf).
- [Reglamento a la LRTI, artículo 162; consolidación publicada con reforma 2025-10-28](https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/03995ac1-408a-4694-b24c-447d93774c52/3.1%20REGLAMENTO%20A%20LA%20LRTI.pdf).
- [Reglamento de comprobantes de venta, retención y documentos complementarios](https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/9fb49475-f058-49a1-b08a-f31bf4deb074/Reglamento_Comprobantes_Venta_RetencionYDC_29122023.pdf).
- [Resolución NAC-DGERCGC25-00000014](https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar?id=137046a6-787c-47fb-a2d7-176595d292dc&nombre=NAC-DGERCGC25-00000014.pdf), leída junto con su [reforma NAC-DGERCGC25-00000017](https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar?id=e98fc8a6-299e-4ea9-8de7-2f6c70dbb4f5&nombre=NAC-DGERCGC25-00000017.pdf).
