# Despliegue: Cloud Run + Vercel + Neon

## Backend

El contexto de construcción es `backend/`. El Dockerfile usa Node 24 y genera
Prisma dentro de Linux. El servidor ejecuta `dist/src/server.js` y escucha en
el puerto indicado por Cloud Run. `.gcloudignore` y `.dockerignore` permiten
solo el código necesario; excluyen respaldos, credenciales y archivos subidos.

Antes del primer despliegue se necesitan el ID del proyecto GCP con facturación,
una sesión de `gcloud` autorizada y la conexión Neon elegida. Habilitar Cloud Run,
Cloud Build, Artifact Registry, Secret Manager y Cloud Storage. Crear una cuenta
de servicio exclusiva para la API.

Guardar `DATABASE_URL` (pooled), `DIRECT_URL` (directa) y un `JWT_SECRET` aleatorio
en Secret Manager. Dar a la cuenta de la API acceso solamente a esos secretos.
No poner credenciales en archivos versionados, argumentos de comandos ni Vercel.

Crear dos buckets privados con acceso uniforme y prevención de acceso público.
Dar `roles/storage.objectUser` a la cuenta de la API en ambos buckets. Montarlos
en Cloud Run de segunda generación:

| Contenido | Ruta | Opciones de montaje |
| --- | --- | --- |
| Imágenes de productos y variantes | `/app/uploads` | `uid=1000;gid=1000` |
| Comprobantes de pago | `/app/uploads-private` | `uid=1000;gid=1000` |

La API sirve las imágenes mediante `/uploads` y los comprobantes mediante sus
endpoints autenticados. Los buckets no necesitan acceso público. Usar inicialmente
1 GiB de memoria, concurrencia 8, mínimo 0 y máximo 2 instancias; los montajes
consumen memoria adicional durante las subidas.

Configurar `NODE_ENV=production`, `CORS_ORIGIN` con el origen HTTPS exacto del
frontend, y los tres secretos. El contenedor desactiva el cron interno mediante
`REMINDERS_ENABLED=false`: los recordatorios requieren un Cloud Run Job y Cloud
Scheduler separados, además de configurar SMTP, para funcionar con escalado a cero.

Para cambios de esquema, construir el target `migrate` del mismo Dockerfile y
ejecutarlo como un Cloud Run Job con los secretos de Neon antes de publicar la API.
Su comando es `prisma migrate deploy`; nunca usar `migrate dev`, `db push` ni el
seed de demostración en producción. Hacer un respaldo antes de aplicar migraciones.
El target final `runtime` es el que se despliega como servicio.

## Frontend

Desplegar la carpeta `frontend/` como proyecto Vite `crm-wm` en Vercel con Node 24.
Si se conecta el repositorio completo, configurar Root Directory en `frontend`.
El proyecto existente llamado `wm` apunta a otro repositorio y no es este destino.

Configurar `VITE_API_URL=https://<servicio-cloud-run>/api` antes de construir.
Es una dirección pública, no un secreto. `vercel.json` configura el build y la
reescritura SPA para que funcionen las rutas abiertas directamente. Usar la URL
estable de producción de Vercel en `CORS_ORIGIN` del backend.

## Verificación antes de dar por terminado

- Cambiar las contraseñas de prueba de los usuarios antes de abrir acceso público.
- Comprobar `/health`, login y Dashboard desde la URL publicada.
- Abrir directamente y recargar una ruta protegida del frontend.
- Verificar CORS desde el dominio real de Vercel.
- Probar una imagen y un comprobante, incluyendo su persistencia tras un reinicio
  y que el comprobante no se pueda descargar sin autenticación.
- Ejecutar las suites con bases de prueba aisladas, nunca con la conexión Neon
  de producción. Revisar los logs de la revisión de Cloud Run que recibe tráfico.

Referencias: [Cloud Storage en Cloud Run](https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts)
y [Vite en Vercel](https://vercel.com/docs/frameworks/frontend/vite).
