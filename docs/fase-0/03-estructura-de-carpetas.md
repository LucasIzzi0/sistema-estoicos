# 03 · Estructura de carpetas

Monorepo con **pnpm workspaces**: 3 aplicaciones y 6 paquetes compartidos. Las rutas de la web están en español porque son lo que ve el usuario en la barra del navegador. El código, en inglés.

```
estoicos/
├── apps/
│   ├── web/                                  # Next.js 16 (App Router) — toda la interfaz
│   │   ├── src/app/
│   │   │   ├── (publico)/reservar/[sucursal]/   # página pública de reservas (sin login para ver horarios)
│   │   │   ├── (auth)/ingresar/                 # clientes: código por email
│   │   │   ├── (auth)/staff/ingresar/           # staff: email + contraseña
│   │   │   ├── (auth)/staff/invitacion/[token]/ # alta de contraseña por invitación
│   │   │   ├── (auth)/staff/recuperar/          # recuperación de contraseña
│   │   │   ├── (cliente)/mi-cuenta/             # portal: reservar, turnos, puntos, historial, perfil
│   │   │   ├── (panel)/admin/                   # dashboard, agenda, caja, clientes, servicios, productos,
│   │   │   │                                    # barberos, pagos-mp, puntos, notificaciones, reportes, configuracion
│   │   │   ├── (panel)/barbero/                 # mi-agenda, cobrar, mis-clientes, mis-comisiones
│   │   │   └── api/[...path]/route.ts           # proxy hacia la API por red privada (ver arquitectura §3)
│   │   ├── src/components/ui/                   # componentes de shadcn/ui (generados)
│   │   ├── src/components/layout/               # sidebar colapsable, drawer mobile, selector de sucursal
│   │   ├── src/features/                        # pantallas por módulo: agenda, cobro, clientes, caja…
│   │   ├── src/lib/api/                         # cliente HTTP tipado con los contratos de @estoicos/shared
│   │   ├── src/proxy.ts                         # (ex middleware) redirecciones según sesión + chequeo Cloudflare
│   │   ├── next.config.ts
│   │   └── railway.json
│   │
│   ├── api/                                  # Fastify 5 — HTTP, seguridad y webhooks
│   │   ├── src/main.ts                          # arranque y apagado ordenado
│   │   ├── src/app.ts                           # registro de plugins y rutas
│   │   ├── src/plugins/                         # sesión, políticas (falla cerrada), rate limit, idempotencia,
│   │   │                                        # errores, contexto de pedido, origen Cloudflare
│   │   ├── src/routes/v1/                       # un archivo por módulo: auth, public, appointments, sales…
│   │   ├── src/routes/webhooks/                 # mercadopago, whatsapp, resend
│   │   ├── test/
│   │   └── railway.json
│   │
│   └── worker/                               # BullMQ — trabajo en segundo plano
│       ├── src/main.ts                          # arranque, latido, apagado ordenado
│       ├── src/schedulers.ts                    # jobs programados con IDs fijos (upsertJobScheduler)
│       ├── src/processors/                      # un archivo por job (ver arquitectura §13)
│       ├── test/
│       └── railway.json
│
├── packages/
│   ├── db/                                   # @estoicos/db — única puerta a la base
│   │   ├── prisma/schema.prisma
│   │   ├── prisma/migrations/                   # migración inicial = schema aprobado + extra.sql; luego una por cambio
│   │   ├── prisma.config.ts                     # URL de la base (convención de Prisma 7)
│   │   └── src/{client.ts, seed/}               # cliente con adapter-pg; seed de ejemplo
│   │
│   ├── shared/                               # @estoicos/shared — SIN dependencias de servidor
│   │   └── src/{contracts/, enums/, permissions/, money/, dates/, phone/}
│   │                                            # esquemas Zod de la API (los usa la web para formularios),
│   │                                            # matriz de permisos, dinero en centavos, fechas, teléfonos
│   │
│   ├── core/                                 # @estoicos/core — reglas de negocio (API y worker)
│   │   └── src/
│   │       ├── domain/                          # funciones puras: disponibilidad, comisiones, puntos, seña, caja
│   │       └── modules/                         # servicios con base de datos, uno por dominio:
│   │           ├── auth/  organization/  catalog/  team/  scheduling/  booking/  customers/
│   │           ├── sales/  payments/  cash/  stock/  commissions/  loyalty/
│   │           └── mercadopago/  notifications/  audit/  reports/  system/
│   │
│   ├── integrations/                         # @estoicos/integrations — clientes externos, sin lógica de negocio
│   │   └── src/{mercadopago/, resend/, whatsapp/, crypto/}
│   │                                            # llamadas HTTP con timeouts, validación de firmas, cifrado AES-GCM
│   │
│   ├── queue/                                # @estoicos/queue — nombres de colas, payloads (Zod), productores
│   └── config/                               # @estoicos/config — tsconfig, eslint y prettier compartidos
│
├── docs/
│   ├── fase-0/                               # este paquete
│   ├── decisiones/                           # una decisión de arquitectura por archivo (ADR)
│   └── runbooks/                             # operar: vincular MP, plantillas WhatsApp, deploy, restaurar backup
│
├── infra/docker-compose.yml                  # Postgres + Redis para desarrollo local
├── .github/workflows/ci.yml                  # lint, tipos, tests, build
├── .env.example                              # todas las variables con valores de ejemplo (sin secretos)
├── package.json · pnpm-workspace.yaml · .nvmrc · .npmrc
└── README.md                                 # cómo levantar el proyecto
```

## Reglas de dependencia (se verifican con lint en CI)

| Paquete        | Puede importar                                  | Nunca importa                                                             |
| -------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| `web`          | `shared`                                        | `db`, `core`, `integrations`, `queue`: la web no toca la base ni secretos |
| `api`          | `core`, `db`, `shared`, `queue`, `integrations` | —                                                                         |
| `worker`       | `core`, `db`, `queue`, `integrations`, `shared` | —                                                                         |
| `core`         | `db`, `shared`, `integrations`, `queue`         | `api`, `worker`                                                           |
| `integrations` | `shared`                                        | `db`, `core`                                                              |
| `queue`        | `shared`                                        | `db`, `core`                                                              |
| `db`, `shared` | (nada interno)                                  | —                                                                         |

## Convenciones

- **Nombres de paquetes:** `@estoicos/<nombre>`.
- **Scripts desde la raíz:**
  - `pnpm dev` levanta web, api y worker en paralelo.
  - `pnpm test`, `pnpm lint` y `pnpm typecheck`.
  - `pnpm db:migrate`, `pnpm db:seed` y `pnpm db:studio`.
- **Rutas de la API:** `/v1/...`, con la sucursal en la URL cuando corresponde (`/v1/branches/:branchId/appointments`). Webhooks en `/webhooks/<proveedor>`.
- **Tests:** unitarios junto al código (`*.test.ts`); de integración en `apps/*/test`.
- **Railway:** un `railway.json` por app. Cada servicio apunta a su archivo con ruta absoluta.
