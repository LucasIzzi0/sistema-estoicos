# 04 · Variables de entorno

**Reglas:**

- Los secretos viven **solo** en las variables de Railway (y en un `.env` local que nunca se commitea).
- El repo tiene un `.env.example` sin valores reales.
- Nada secreto lleva el prefijo `NEXT_PUBLIC_`: ese prefijo lo expone al navegador.
- Al arrancar, cada servicio valida sus variables con Zod y **no arranca** si falta una obligatoria.
- Los tokens de Mercado Pago **no son variables de entorno**: se cargan desde el panel y se guardan cifrados en la base.

**Servicios:** W = web · A = api · K = worker · S = solo desarrollo o seed.
**Secreto:** 🔒 = es secreto. Se rota si se filtra, y nunca se loguea.

## General

| Variable                    | Servicios | Ejemplo                                    | Para qué                                                              |
| --------------------------- | --------- | ------------------------------------------ | --------------------------------------------------------------------- |
| `NODE_ENV`                  | W A K     | `production`                               | Modo de Node.                                                         |
| `APP_ENV`                   | W A K     | `development` \| `staging` \| `production` | Distingue staging de producción (seed, avisos, sandbox de MP).        |
| `LOG_LEVEL`                 | A K       | `info`                                     | Nivel de logs (pino).                                                 |
| `DEFAULT_ORGANIZATION_SLUG` | W A K     | `estoicos`                                 | En la v1 hay una sola organización. A futuro se resuelve por dominio. |
| `APP_PUBLIC_URL`            | W A K     | `https://app.estoicos.com.ar`              | Links en emails y mensajes, `back_urls` de Checkout Pro.              |
| `API_PUBLIC_URL`            | A K       | `https://api.estoicos.com.ar`              | `notification_url` de las preferencias de seña.                       |
| `SENTRY_DSN`                | W A K     | `https://…`                                | Opcional (recomendado): errores en producción.                        |

## Base de datos y colas

| Variable          | Servicios | Ejemplo                         | Para qué                                                                                   |
| ----------------- | --------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL` 🔒 | A K       | `${{Postgres.DATABASE_URL}}`    | PostgreSQL por red privada. La usa también `prisma migrate deploy` (pre-deploy de la API). |
| `REDIS_URL` 🔒    | A K       | `${{Redis.REDIS_URL}}?family=0` | Colas BullMQ y rate limiting. `family=0` es lo que recomienda Railway para su red privada. |

## Seguridad

| Variable                          | Servicios | Ejemplo             | Para qué                                                                                                   |
| --------------------------------- | --------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `DATA_ENCRYPTION_KEY` 🔒          | A K       | 32 bytes en base64  | Cifra y descifra los tokens de Mercado Pago (AES-256-GCM). **Si se pierde, hay que volver a vincular MP.** |
| `DATA_ENCRYPTION_KEY_PREVIOUS` 🔒 | A K       | 32 bytes en base64  | Opcional. Solo durante una rotación de clave.                                                              |
| `AUTH_CODE_SECRET` 🔒             | A         | 32 bytes aleatorios | Clave del HMAC con que se guardan los códigos de login.                                                    |
| `INTERNAL_API_SECRET` 🔒          | W A       | 32 bytes aleatorios | La web lo manda al reenviar pedidos a la API. La API rechaza las rutas de negocio que llegan sin él.       |
| `CLOUDFLARE_ORIGIN_SECRET` 🔒     | W A       | 32 bytes aleatorios | Cloudflare lo agrega a cada pedido. Si falta, el pedido no pasó por Cloudflare y se rechaza.               |

## Web (Next.js)

| Variable                                | Servicios | Ejemplo                            | Para qué                                                            |
| --------------------------------------- | --------- | ---------------------------------- | ------------------------------------------------------------------- |
| `PORT`                                  | W         | la asigna Railway                  | Puerto HTTP.                                                        |
| `API_INTERNAL_URL`                      | W         | `http://api.railway.internal:8080` | Dirección privada de la API, para el proxy y los Server Components. |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` 🔒 | W         | 32 bytes en base64                 | Estable entre deploys, para que dos versiones convivan sin errores. |

## API

| Variable        | Servicios | Ejemplo                  | Para qué                                                                |
| --------------- | --------- | ------------------------ | ----------------------------------------------------------------------- |
| `PORT` / `HOST` | A         | la asigna Railway / `::` | `::` escucha en IPv4 e IPv6, lo que necesita la red privada de Railway. |

## Email (Resend)

| Variable                   | Servicios | Ejemplo                                  | Para qué                                                            |
| -------------------------- | --------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `RESEND_API_KEY` 🔒        | A K       | `re_…`                                   | La API envía los códigos de login y el worker el resto.             |
| `EMAIL_FROM`               | A K       | `Estoicos <turnos@mail.estoicos.com.ar>` | Remitente. Va en un subdominio de envío y **no** en "no-reply".     |
| `EMAIL_REPLY_TO`           | A K       | `hola@estoicos.com.ar`                   | A dónde van las respuestas.                                         |
| `RESEND_WEBHOOK_SECRET` 🔒 | A         | `whsec_…`                                | Verifica la firma de los webhooks de estado (entregado, rebotado…). |

## WhatsApp (Meta Cloud API) — todas opcionales: sin ellas, todo sale por email

| Variable                           | Servicios | Ejemplo              | Para qué                                                 |
| ---------------------------------- | --------- | -------------------- | -------------------------------------------------------- |
| `WHATSAPP_ACCESS_TOKEN` 🔒         | K         | token de System User | Enviar mensajes. Conviene el token sin vencimiento.      |
| `WHATSAPP_PHONE_NUMBER_ID`         | K         | `1234567890`         | Número emisor.                                           |
| `WHATSAPP_BUSINESS_ACCOUNT_ID`     | K         | `1234567890`         | Cuenta de WhatsApp Business (plantillas).                |
| `WHATSAPP_GRAPH_API_VERSION`       | K         | `v26.0`              | Versión de la Graph API (fijada).                        |
| `WHATSAPP_APP_SECRET` 🔒           | A         | —                    | Verifica la firma `X-Hub-Signature-256` de los webhooks. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` 🔒 | A         | texto aleatorio      | Verificación inicial del webhook (`hub.verify_token`).   |

> Hoy WhatsApp va por variables de entorno porque hay un solo número. Si en el futuro cada marca tiene el suyo, pasa a una tabla cifrada, igual que Mercado Pago.

## Mercado Pago

| Variable                    | Servicios | Ejemplo | Para qué                                                                                                                    |
| --------------------------- | --------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `MP_OAUTH_CLIENT_ID`        | A         | —       | **Solo a futuro** (OAuth para franquicias).                                                                                 |
| `MP_OAUTH_CLIENT_SECRET` 🔒 | A         | —       | Ídem.                                                                                                                       |
| `MP_WEBHOOK_SECRET` 🔒      | A         | —       | **Solo con OAuth.** En la v1 la clave de webhooks es de la aplicación de la barbería y se guarda cifrada junto a la cuenta. |

## Worker

| Variable                        | Servicios | Ejemplo | Para qué                                                         |
| ------------------------------- | --------- | ------- | ---------------------------------------------------------------- |
| `WORKER_CONCURRENCY`            | K         | `5`     | Jobs en paralelo por cola (las de barrido van siempre de a 1).   |
| `QUEUE_STUCK_THRESHOLD_MINUTES` | K         | `10`    | La "N" de la alerta de cola trabada o job atascado.              |
| `WORKER_HEALTH_PORT`            | K         | `8081`  | Endpoint `/health` para el chequeo de Railway durante el deploy. |

## Solo desarrollo, staging y tests

| Variable                                      | Servicios | Ejemplo | Para qué                                                           |
| --------------------------------------------- | --------- | ------- | ------------------------------------------------------------------ |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` 🔒 | S         | —       | Admin del seed. El seed se niega a correr si `APP_ENV=production`. |
| `DATABASE_URL_TEST` / `REDIS_URL_TEST`        | S         | locales | Base y Redis descartables para tests de integración.               |

## Las provee Railway (no se cargan a mano)

`PORT`, `RAILWAY_ENVIRONMENT_NAME`, `RAILWAY_GIT_COMMIT_SHA` (versión en logs y latido), `RAILWAY_PRIVATE_DOMAIN` y las referencias `${{Servicio.VARIABLE}}`.

## Configuración que NO va en variables

Va en la base y se edita desde el panel, con auditoría:

- Reglas de reservas, seña y cancelación.
- Reglas de puntos y vencimiento.
- Tiempos de recordatorio y reactivación.
- Nombres de plantillas de WhatsApp.
- Link de reseñas por sucursal.
- Cuenta y terminales de Mercado Pago.
