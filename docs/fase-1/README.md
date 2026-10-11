# Fase 1 — Base, acceso y esqueleto

**Fecha:** 25/09/2026
**Estado:** terminada en local y **esperando aprobación**. Falta la publicación en Railway, que necesita las respuestas P1 a P3 (dominio, cuentas y datos de la sucursal).

## Qué quedó hecho

| Pieza              | Detalle                                                                                                                                                                                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo           | pnpm 12, TypeScript 6, ESLint con reglas de dependencias entre paquetes (la web no puede importar la base ni el core), Prettier, Vitest, CI en GitHub Actions con Postgres y Redis reales                                                                                                                            |
| Base de datos      | Migración inicial = schema aprobado en la Fase 0 + `extra.sql` (anti doble reserva, CHECKs, ledgers inmutables). Seed idempotente que se niega a correr en producción.                                                                                                                                               |
| Acceso de clientes | Código de 6 dígitos por email: guardado con HMAC, vence a los 10 min, 5 intentos contados de forma atómica, pedir uno nuevo invalida el anterior. Límites de 3 cada 15 min y 10 por día por email, más un límite por IP. Respuesta idéntica exista o no el email. Sesión de 30 días.                                 |
| Perfil del cliente | Nombre, celular normalizado a +549… y canal preferido. Los consentimientos se registran con fecha, IP y versión del texto; solo se guarda un evento cuando cambian.                                                                                                                                                  |
| Acceso del staff   | Contraseña con argon2id. Bloqueo de 15 min tras 5 fallos. Invitación por email (link de 72 h). Recuperación de contraseña, que cierra las sesiones abiertas. Segundo factor por email listo (se activa por usuario).                                                                                                 |
| Permisos           | Matriz única en `packages/shared` (dueño, encargado, barbero). Cada ruta de la API declara su política; **si falta, la API no arranca**. La sucursal se valida en cada pedido. Cambiar el acceso de alguien cierra sus sesiones al instante.                                                                         |
| Seguridad de red   | La web reenvía `/api/*` a la API por red privada. Las rutas de negocio pedidas sin el secreto interno responden 404. CSRF por Origin. Cookies `__Host-` en producción. Header secreto de Cloudflare. Logs que no muestran cookies, firmas ni secretos.                                                               |
| Auditoría          | Invitaciones, cambios de rol o de sucursal, bajas y cambios de contraseña.                                                                                                                                                                                                                                           |
| Worker             | Jobs programados con IDs fijos (registrarlos dos veces no los duplica), concurrencia global 1, latido cada 30 s, monitor de colas cada minuto, limpieza diaria, apagado ordenado con límite de tiempo, endpoint de salud.                                                                                            |
| Alertas            | Worker caído, cola atrasada, job trabado y fallas repetidas. Se abren, se actualizan y se resuelven solas, y el admin las marca como vistas.                                                                                                                                                                         |
| Web                | Tema de la marca, modo claro y oscuro. Panel admin (sidebar colapsable, drawer en el celular, selector de sucursal). Panel del barbero. Portal del cliente mobile first con barra inferior. Página pública (estructura). Dashboard con el estado del sistema. **Gestión del equipo:** invitar, reenviar, desactivar. |
| Railway            | `railway.json` por servicio: migraciones antes de cada deploy (solo la API), chequeos de salud, 1 réplica del worker, tiempos de drenaje.                                                                                                                                                                            |

## Verificación

- **65 tests en verde:**
  - 43 de la API contra Postgres y Redis reales:
    - Todas las reglas del código por email.
    - Bloqueo del staff.
    - Invitaciones, recuperación y segundo factor.
    - **Matriz de permisos: todas las rutas × anónimo, cliente, barbero, encargado y dueño.**
    - Alcance por sucursal, secreto interno, CSRF, salud del sistema.
  - 2 del worker: jobs programados sin duplicados, monitor de colas.
  - 20 de paquetes: dinero, teléfonos argentinos, permisos, cifrado, contraseñas.
- **Recorrido completo con los 3 servicios levantados** (web → proxy → API → base), probado con pedidos HTTP reales y con capturas de pantalla en escritorio y celular, sin errores de consola.
- `next build` de producción OK. Lint y tipos OK en los 8 paquetes.

## Decisiones tomadas durante la fase

| Decisión                                                                                            | Motivo                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API y worker corren con `tsx` sobre el código TypeScript, sin paso de compilación                   | Con pnpm, empaquetar rompe la resolución de dependencias internas (Prisma, argon2). Así producción corre igual que los tests. Se revisa si el tiempo de arranque llegara a importar. |
| Railway con Railpack, sin Dockerfile, y Next sin `output: standalone`                               | Sin Docker en esta máquina no se pueden probar imágenes; Railpack detecta pnpm workspaces. Standalone solo hace falta con Docker.                                                    |
| Celulares: un número argentino de 10 dígitos escrito sin el 9 ("11 2233-4455") se toma como celular | Así lo escribe la gente, y el campo es siempre "celular / WhatsApp". Sin característica se rechaza.                                                                                  |
| Casillas de consentimiento destildadas por defecto                                                  | El consentimiento tiene que ser una decisión explícita (Ley 25.326).                                                                                                                 |
| Los componentes de shadcn usan Radix                                                                | Es la base más madura. shadcn 4 ofrece además Base UI y React Aria.                                                                                                                  |

## Cómo probarlo

Seguir el [README de la raíz](../../README.md). En desarrollo:

- Los emails se muestran en la consola de la API (no hace falta Resend).
- La contraseña del dueño está en `SEED_ADMIN_PASSWORD` del `.env`.

## Pendiente para cerrar la fase

1. **Publicar en staging** (Railway + Cloudflare + dominio de Resend). Necesito P1 (dominio), P2 (cuentas) y P3 (datos de la sucursal). Después hay que verificar `btree_gist` en el Postgres de Railway (riesgo R25).
2. Commit inicial y repo en GitHub. Todavía no se commiteó nada: el código espera tu revisión.
