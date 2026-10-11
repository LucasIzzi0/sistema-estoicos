# Fase 0 — Plan de arquitectura (propuesta para revisión)

**Proyecto:** sistema de gestión para barberías (nombre de trabajo: _Estoicos_)
**Fecha:** 25/09/2026
**Estado:** esperando aprobación. **No hay código de aplicación.** Solo documentación, el schema de la base y las pruebas de ese schema.

## Contenido

| Documento                                                    | Qué es                                                                                                                                     | Para quién   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| [01-arquitectura.md](01-arquitectura.md)                     | Cómo se arma el sistema, flujos críticos (reserva, cobro con Point, webhooks, señas), seguridad, confiabilidad y las 18 decisiones tomadas | Arquitecto   |
| [02-modelo-de-datos.md](02-modelo-de-datos.md)               | El modelo explicado: diagramas, estados, qué garantiza la base, glosario, qué queda listo para el futuro                                   | Ambos        |
| [schema.prisma](schema.prisma)                               | Schema completo de Prisma: 58 tablas, 50 enums, comentado en español                                                                       | Arquitecto   |
| [extra.sql](extra.sql)                                       | Lo que Prisma no puede expresar: anti doble reserva, 64 CHECKs, ledgers inmutables                                                         | Arquitecto   |
| [verificacion-db.sql](verificacion-db.sql)                   | Las 41 pruebas de las reglas de la base                                                                                                    | Arquitecto   |
| [03-estructura-de-carpetas.md](03-estructura-de-carpetas.md) | Organización del monorepo y reglas de dependencia                                                                                          | Arquitecto   |
| [04-variables-de-entorno.md](04-variables-de-entorno.md)     | Variables por servicio, cuáles son secretas                                                                                                | Ambos        |
| [05-riesgos.md](05-riesgos.md)                               | 39 riesgos con mitigación; los 8 principales arriba de todo                                                                                | Ambos        |
| [06-preguntas.md](06-preguntas.md)                           | **7 preguntas que necesito responder** + 42 con respuesta por defecto                                                                      | **Fundador** |
| [07-plan-de-fases.md](07-plan-de-fases.md)                   | Fases ajustadas, con entregables, tests y criterio de "listo"                                                                              | Ambos        |

## Resumen para el fundador

1. **Tres programas separados:**
   - La **web**: lo que ven clientes, barberos y admins.
   - La **API**: las reglas y la seguridad.
   - El **worker**: el trabajo en segundo plano (recordatorios, pagos, vencimientos).

   Van con PostgreSQL como base de datos y Redis para las colas, en Railway detrás de Cloudflare, tal como pediste.

2. **Multi-sucursal desde el día 1.** Los clientes y sus puntos son de la marca y valen en todas las sucursales. El modelo ya contempla franquicias (un encargado que solo ve su sucursal, y cada sucursal puede cobrar con su propia cuenta de Mercado Pago), sin construir esa parte ahora.
3. **Nadie puede reservar dos veces el mismo horario.** Lo impide la base de datos y lo probé con dos reservas simultáneas: siempre queda una sola.
4. **La plata se guarda en centavos y sin decimales.** Puntos, saldo a favor, stock y comisiones son movimientos que **nadie puede editar ni borrar** (la base lo bloquea). Los errores se corrigen con un movimiento nuevo, con motivo y usuario.
5. **Todo o nada al cobrar.** Cuando una venta queda pagada, en un solo paso se generan las comisiones, se acreditan los puntos y se descuenta el stock. No existen estados "a medias".
6. **Mercado Pago:**
   - El cobro sale del sistema y el Point lo muestra solo.
   - La confirmación llega por un aviso firmado de MP y **igual se verifica** consultando a MP.
   - Todo pago de la cuenta que no reconozcamos va a una bandeja para asignarlo.
7. **Notificaciones por WhatsApp con respaldo automático por email.** El sistema funciona completo aunque WhatsApp todavía no esté aprobado.
8. **Seguridad:**
   - Cada acción sensible queda registrada.
   - La API verifica rol **y** sucursal en cada pedido; no alcanza con esconder botones.
   - Los tokens de Mercado Pago se guardan cifrados.
9. **Cinco ajustes al orden de fases.** Los principales:
   - Publicar en Railway desde la Fase 1.
   - Poder empezar a usar el sistema en el local al terminar la Fase 4.
10. **Hay 7 preguntas que necesitan tu respuesta.** Las otras 42 tienen una respuesta por defecto que uso si no decís nada.

## Qué se verificó (no es solo papel)

| Verificación                                                                                                  | Resultado                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema con **Prisma 7.10** (`validate`, `format`, `generate`)                                                 | ✅ Válido; el cliente se genera sin errores                                                                                                                                           |
| Migración completa (Prisma + `extra.sql`) sobre **PostgreSQL 16** vacío                                       | ✅ 58 tablas, 1 restricción anti doble reserva, 64 CHECKs, 7 triggers, 3 índices únicos parciales                                                                                     |
| **Drift:** ¿Prisma querría borrar lo agregado a mano?                                                         | ✅ No: "empty migration" contra el historial y contra la base real                                                                                                                    |
| 41 pruebas de reglas (doble reserva, caja única, ledger inmutable, montos, signos, cobros, órdenes Point)     | ✅ 41/41                                                                                                                                                                              |
| Dos reservas **simultáneas** del mismo horario                                                                | ✅ Siempre 1 turno. Además se detectó que, **sin** el lock por barbero, Postgres lo resuelve con un deadlock; con el lock, el rechazo es limpio. Por eso el diseño usa las dos capas. |
| Documentación oficial actual de Mercado Pago, WhatsApp, Resend, Railway, BullMQ, Prisma, Next.js y Cloudflare | ✅ Revisada. Cambió varias decisiones (ver riesgos R1, R5, R7, R12, R19).                                                                                                             |

## Para arrancar la Fase 1 necesito

1. Tu **aprobación explícita** de esta fase, con los cambios que pida el arquitecto.
2. Respuestas a **P1** (dominio), **P2** (cuentas de GitHub, Railway, Cloudflare y Resend a nombre de la empresa) y **P3** (nombre y datos de la sucursal).
3. Estas otras no bloquean la Fase 1, pero conviene moverlas ya porque tardan:
   - **P5** (modelo de Point).
   - **P6** (número de WhatsApp y verificación del negocio en Meta).
   - Una **consulta legal** sobre datos personales (R30).

## Sugerencia para la revisión con el arquitecto

Los puntos donde más vale su mirada:

- **D1**: la web reenvía a la API por red privada, sin CORS.
- **D3**: `BigInt` para el dinero.
- **D6**: anti doble reserva en dos capas.
- **D8**: la base como fuente de verdad de los jobs.
- **D12, D13 y D14**: versiones fijadas (Prisma 7, TypeScript 6, ioredis 5).
- **El diseño de Mercado Pago** (§9 de arquitectura), en especial:
  - el cambio de `external_reference`.
  - la idempotencia de webhooks sin rechazar por antigüedad.
  - la conciliación.
