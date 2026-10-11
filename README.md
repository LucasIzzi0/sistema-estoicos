# Estoicos · Sistema de gestión de la barbería

Monorepo con pnpm: web (Next.js), API (Fastify), worker (BullMQ), PostgreSQL y Redis.
La arquitectura, el modelo de datos y el plan de fases están en [`docs/fase-0`](docs/fase-0/README.md). El estado de cada fase, en [`docs/fase-1`](docs/fase-1/README.md), [`docs/fase-2`](docs/fase-2/README.md), [`docs/fase-3`](docs/fase-3/README.md), [`docs/fase-4`](docs/fase-4/README.md), [`docs/fase-5`](docs/fase-5/README.md), [`docs/fase-6`](docs/fase-6/README.md), [`docs/fase-7`](docs/fase-7/README.md) y [`docs/fase-8`](docs/fase-8/README.md).

> **Antes de arrancar en esta Mac:** ver [`docs/entorno.md`](docs/entorno.md). iCloud vacía archivos de `node_modules` y rompe el entorno con errores que no son del código; ahí está la receta para destrabarlo.


## Requisitos

- Node.js 24 (`.nvmrc`) y pnpm 12 (`npm i -g pnpm@12.6.0`).
- PostgreSQL 16 y Redis 7: con Homebrew (`brew install postgresql@16 redis`) o con Docker (`docker compose -f infra/docker-compose.yml up -d`).

## Primer arranque

```bash
cp .env.example .env            # completar: generar secretos con `openssl rand -base64 32`
createdb estoicos_dev && createdb estoicos_test && createdb estoicos_shadow
pnpm install                    # también genera el cliente de Prisma
pnpm db:deploy                  # aplica las migraciones a DATABASE_URL
pnpm db:seed                    # datos de ejemplo (dueño, 2 barberos, servicios, clientes)
pnpm dev                        # web :3000 · api :4000 · worker
```

Entrar:

- **Panel:** http://localhost:3000/staff/ingresar con `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. Los barberos (Juan y Pedro) no tienen usuario: son perfiles que gestiona el admin.
- **Portal de clientes:** http://localhost:3000/ingresar con cualquier email. Sin `RESEND_API_KEY`, el código aparece en la consola de la API.

## Comandos

| Comando                        | Qué hace                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `pnpm dev`                     | Levanta web, API y worker con recarga automática                                        |
| `pnpm test`                    | Todos los tests. Los de integración usan `DATABASE_URL_TEST` y `REDIS_URL_TEST` reales. |
| `pnpm lint` / `pnpm typecheck` | Calidad de código                                                                       |
| `pnpm db:migrate`              | Crea una migración nueva a partir de cambios en `packages/db/prisma/schema.prisma`      |
| `pnpm db:studio`               | Explorador visual de la base                                                            |

## Estructura

```
apps/web       Next.js 16: panel (dueño, encargado, recepción), portal del cliente, reservas públicas
apps/api       Fastify 5: autenticación, permisos por rol y sucursal, reglas de negocio, webhooks
apps/worker    BullMQ: jobs programados, latido, monitoreo, (luego) notificaciones y pagos
packages/db            Prisma 7 (schema, migraciones, seed)
packages/shared        Contratos Zod, permisos, dinero, teléfonos (lo usa también la web)
packages/core          Reglas de negocio (las usan la API y el worker)
packages/integrations  Resend, cifrado, contraseñas (y luego Mercado Pago y WhatsApp)
packages/queue         Colas y jobs programados
```
