# Despliegue: Railway + Vercel + Neon

| Parte | Servicio | Dirección | Despliegue |
| --- | --- | --- | --- |
| Frontend | Vercel, proyecto `crm-wm` | https://crm-wm.vercel.app | Automático al hacer push a `main` |
| Backend | Railway, proyecto `crm-wm`, servicio `CRM-WM` (US East) | https://crm-wm-production.up.railway.app | Automático al hacer push a `main` |
| Base de datos | Neon (`us-east-2`) | — | Migraciones manuales antes del push |

Es una solución provisional hasta disponer de un servidor Ubuntu propio; ver
[Migración a un servidor Ubuntu](#migración-a-un-servidor-ubuntu).

## Backend (Railway)

El servicio se construye con `backend/Dockerfile` (Node 24, Prisma generado dentro
de Linux) y ejecuta `dist/src/server.js`. `.dockerignore` excluye credenciales,
respaldos y archivos subidos.

Configuración del servicio:

- **Source:** repositorio `WaldoAlejo/CRM-WM`, rama `main`, Root Directory `/backend`.
  El builder detecta el Dockerfile y usa su último target (`runtime`).
- **Región:** US East (Virginia), la más cercana a Neon `us-east-2`.
- **Recursos:** límite de réplica 1 vCPU y 1 GB. Railway cobra por uso; el límite
  evita consumos inesperados.
- **Networking:** dominio público con puerto `8080`.
- **Healthcheck:** `/health`, que también verifica la conexión a la base.
- **Volumen:** `crm-wm-volume` montado en `/data`. Contiene `uploads/` (imágenes de
  productos, servidas en `/uploads`) y `uploads-private/` (comprobantes de pago,
  solo mediante endpoints autenticados). Configurar respaldos en la pestaña
  Backups del servicio.

Variables del servicio (pestaña Variables del servicio, nunca Shared Variables):

| Variable | Valor |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `8080` |
| `DATABASE_URL` | Conexión pooled de Neon |
| `DIRECT_URL` | Conexión directa de Neon |
| `JWT_SECRET` | Cadena aleatoria larga, exclusiva de producción |
| `JWT_EXPIRES_IN` | Duración de la sesión |
| `SETTINGS_ENCRYPTION_KEY` | La misma clave con la que se cifraron firma y correo (ver abajo) |
| `CORS_ORIGIN` | `http://localhost:5173,https://crm-wm.vercel.app` |
| `STORAGE_DIR` | `/data` |
| `RAILWAY_RUN_UID` | `0`: el volumen se monta como root y el contenedor usa otro usuario |
| `FISCAL_PRODUCTION_ENABLED` | `false` hasta completar las pruebas con el SRI |
| `FISCAL_WORKER_ENABLED` | `true` |
| `REMINDERS_ENABLED` | `false` hasta verificar el correo; luego `true` |

`CORS_ORIGIN` es obligatoria en producción y acepta varios orígenes separados por
comas, sin espacios ni `/` final. Cambiar una variable redespliega el servicio.

El proceso permanece encendido, por lo que la cola fiscal y el cron interno de
recordatorios funcionan dentro del mismo servicio; no se necesitan jobs aparte.

### Migraciones

Neon es externo a Railway: las migraciones se aplican desde una máquina con la
conexión de producción en `backend/.env`, **antes** de hacer push del código que
las requiere:

```
cd backend
npx prisma migrate status
npm run prisma:deploy
```

Nunca usar `migrate dev`, `db push` ni el seed de demostración contra producción.
Hacer un respaldo (branch de Neon) antes de aplicar migraciones.

### Acceso al contenedor

Con la CLI de Railway (`npm install -g @railway/cli`, `railway login`) y una clave
SSH registrada (`railway ssh keys add`):

```
railway ssh --project=<id> --environment=<id> --service=<id>
```

El comando con los identificadores aparece en la pestaña Console del servicio.
Los logs de arranque y errores están en Deployments → View logs.

## Frontend (Vercel)

Proyecto `crm-wm` conectado a `WaldoAlejo/CRM-WM` con Root Directory `frontend`,
preset Vite, `npm run build`, salida `dist` y Node 24. `vercel.json` define la
reescritura SPA para que las rutas abiertas directamente funcionen. El proyecto
llamado `wm` pertenece a otro repositorio y no es este destino.

`VITE_API_URL=https://crm-wm-production.up.railway.app/api` está configurada para
Production. Se incorpora al construir: tras cambiarla hay que redesplegar. Para
usar vistas previas de pull requests, agregarla también en Preview y añadir su
dominio a `CORS_ORIGIN`; esas vistas usarían la base real.

Despliegue manual, si hiciera falta: `vercel deploy --prod` desde `frontend/`.

## Facturación electrónica

`SETTINGS_ENCRYPTION_KEY` (32 bytes, 64 caracteres hexadecimales) cifra la firma
P12 y las contraseñas SMTP guardadas en la base. Debe ser idéntica en todos los
entornos que usen la misma base y mantenerse estable entre versiones: su pérdida
impide descifrar las credenciales. Respaldarla por separado de la base y nunca
generarla automáticamente en el arranque.

El contenedor incluye los XSD oficiales en `/app/resources/sri`. La emisión de
producción permanece bloqueada salvo `FISCAL_PRODUCTION_ENABLED=true`; habilitarla
solo después de comprobar factura, nota de crédito y guía con una firma real en el
ambiente de pruebas del SRI. Desde Railway (US East) se verificó conexión con
`celcer.sri.gob.ec` y `cel.sri.gob.ec`.

La cola interna consulta el SRI con espera creciente
(`FISCAL_AUTHORIZATION_WAIT_SECONDS`, 5 s por defecto). Como alternativa a la cola
interna existe `node dist/src/jobs/runFiscalQueue.js`, apto para un cron externo;
varios procesadores comparten bloqueos en la base y la misma clave del comprobante.

Railway bloquea el SMTP saliente fuera del plan Pro. En Configuración → Correo se
usa la forma de envío **Resend · API HTTPS** (puerto 443): API key de Resend y un
remitente cuyo dominio esté verificado en Resend (registros DNS en GoDaddy). Las
respuestas siguen llegando al buzón de GoDaddy.

La configuración SMTP por variables funciona hasta seleccionar una cuenta general
desde la aplicación. Los comprobantes usan la cuenta de su propia empresa y los
recordatorios la cuenta general. Configurar una cuenta puede habilitar los
recordatorios existentes: revisar `REMINDERS_ENABLED` y el límite de atraso.

## Verificación antes de dar por terminado

- Cambiar las contraseñas de prueba de los usuarios antes de abrir acceso público.
- Comprobar `/health`, login y Dashboard desde https://crm-wm.vercel.app.
- Abrir directamente y recargar una ruta protegida del frontend.
- Verificar CORS desde el dominio de Vercel.
- Probar una imagen y un comprobante de pago, incluyendo su persistencia tras un
  redespliegue y que el comprobante no se pueda descargar sin autenticación.
- Confirmar en Configuración → Facturación electrónica que la firma aparece
  vigente (prueba de que `SETTINGS_ENCRYPTION_KEY` es la correcta).
- Ejecutar las suites con bases de prueba aisladas, nunca con la conexión Neon de
  producción.

## Migración a un servidor Ubuntu

El mismo `backend/Dockerfile` sirve para el servidor propio:

1. Instalar Docker y construir la imagen desde `backend/`.
2. Ejecutarla con las variables de la tabla anterior (sin `RAILWAY_RUN_UID`), un
   volumen persistente montado en `/data` y reinicio automático
   (`restart: unless-stopped` en Docker Compose).
3. Publicarla detrás de un proxy inverso con HTTPS (Nginx o Caddy) y un dominio.
4. Copiar el contenido de `/data` desde Railway (`railway ssh` + `tar`) antes de
   cambiar el tráfico.
5. Actualizar `VITE_API_URL` en Vercel, redesplegar el frontend y mantener el
   dominio del frontend en `CORS_ORIGIN`.
6. Verificar desde el servidor la conexión al SRI antes de desactivar Railway.

Referencias: [Volúmenes en Railway](https://docs.railway.com/reference/volumes),
[Vite en Vercel](https://vercel.com/docs/frameworks/frontend/vite) y
[monorepos en Vercel](https://vercel.com/docs/monorepos).
