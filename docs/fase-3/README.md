# Fase 3 — Agenda y reservas

**Fecha:** 25/09/2026
**Estado:** aprobada (25/09/2026).
Aplica las respuestas de producto P13, P14 y P15 ([decisiones](../decisiones/2026-09-25-respuestas-de-producto.md)).

## Qué quedó hecho

| Módulo | Detalle |
|---|---|
| **Motor de disponibilidad** | Función pura con tests propios. Calcula: horario del barbero ese día − bloqueos − feriados − turnos activos (en **cualquier** sucursal). Ofrece turnos cada 15 min donde entra el servicio completo, con la duración propia de cada barbero. Trabaja en hora local de la sucursal (zona IANA), así un eventual horario de verano no corre los turnos. |
| **Sin doble reserva** | Dos capas: **lock por barbero** dentro de la transacción (se revalida todo) y la **restricción de la base**, que es la garantía final. Un choque o un deadlock se traduce a "Ese horario ya no está disponible". Si hay cliente, también se toma su lock, así dos pedidos simultáneos no superan el máximo de turnos. |
| **Reserva online** (`/reservar/principal`) | Pensada para el celular: servicios (uno o varios, **mismo barbero**) → barbero o **"cualquiera"** → día → horario → email y código → datos si es nuevo → confirmación. Los horarios se ven **sin loguearse**. "Cualquiera" asigna al barbero con **menos minutos reservados ese día** (si empatan, el orden del admin); si justo se ocupa, prueba con el siguiente. |
| **Reglas online (P15)** | Mínimo **60 min** de anticipación, hasta **30 días**, máximo **2 turnos futuros** por cliente, cambiar el horario hasta **3 h antes** y cancelar **hasta la hora del turno**. Todo configurable. Rate limit en los horarios públicos y en la creación de turnos. |
| **Portal del cliente** | **Mis turnos**: próximos (cancelar o **cambiar horario** con el mismo selector de días) e historial. "Reservar" lleva a la página de la sucursal (si hay varias, se elige). |
| **Agenda del panel** | Vista **día** (una columna por barbero) y **semana** (un barbero). Muestra su horario (lo gris es "no trabaja"), bloqueos, feriados y la línea de "ahora". Se actualiza sola cada 30 s. **Clic en un hueco** → nuevo turno con barbero y hora ya cargados. Al buscar cliente se lo puede dar de alta ahí mismo. Muestra los horarios libres de ese día. |
| **Turnos desde el local** | Fuera del horario del barbero **pide confirmación** ("Agendar igual"). **Pisar otro turno no se puede nunca**. Mover de día, hora o barbero; cambiar servicios (los que ya estaban mantienen su precio reservado). **Atención sin turno**: empieza ahora, cliente opcional. |
| **Estados** | Reservado → Confirmado → En curso → Atendido; No vino (solo después de la hora; quitarlo queda **auditado**); Cancelado con motivo. Cada cambio queda en el **historial del turno** con quién y cuándo. |
| **Ficha del cliente** | **Últimos turnos** con estado, barbero y sucursal. Contador de ausencias (y aviso ⚠ en la agenda si ya faltó). **Fusionar duplicado** (dueño y encargado): pasan turnos, notas, datos faltantes y consentimientos, y el repetido deja de aparecer. Queda auditado. |
| **Notificaciones (email)** | **Bandeja de salida**: el aviso se guarda en la misma transacción que el turno y el worker lo envía. Confirmación, reprogramación y cancelación, con link a "Mis turnos" y a Google Calendar. Solo se envía si el cliente aceptó los avisos de turnos; si no, queda registrado como "omitido" con el motivo. Reintentos con espera creciente; el despachador corre cada minuto; un job repetido no manda dos veces. |

## Verificación

- **148 tests en verde** (antes 101):
  - 17 del motor de disponibilidad: bordes de horario, turno partido, bloqueos, feriados, anticipación, paso, zona horaria y horario de verano.
  - 29 de reservas y agenda, entre ellos:
    - **10 pedidos simultáneos al mismo horario → 1 turno** (repetido 6 veces seguidas, siempre igual).
    - 4 clientes online a la vez por el mismo horario → 1 turno.
    - Reglas online, "cualquier barbero", cancelar y reprogramar, estados, sin turno, fusión y alcance por sucursal.
  - El worker encola y envía cada notificación **una sola vez**.
  - La matriz de permisos ahora cubre las 17 rutas nuevas.
- **Recorrido en el navegador**, con los 3 servicios levantados:
  - Un cliente nuevo reserva desde el celular (email, código y datos), cambia el horario y alcanza el máximo de 2 turnos.
  - El dueño ve la reserva online en la agenda y la confirma.
  - Agenda un turno buscando al cliente y uno fuera de horario (con la confirmación).
  - Revisa la vista semanal, la ficha del cliente y la agenda en el celular.
  - Los emails de confirmación y de cambio de horario salieron del worker.
- Lint, tipos (8 paquetes) y `next build` OK.

## Bug encontrado y corregido (venía de la Fase 1)

Prisma manda las fechas **sin zona horaria** y Postgres las interpretaba con la zona del servidor. El Postgres local tiene la de Chile, así que todo lo que escribía la app quedaba **3 horas corrido** en la base. La app no lo notaba porque leía con el mismo corrimiento, pero no coincidía con `now()` ni con las fechas que pone la propia base. **Arreglo:** cada conexión se fuerza a UTC. Hay un test que falla si vuelve a pasar (se verificó que detecta el bug). En Railway probablemente no se hubiera visto, porque ahí el servidor suele estar en UTC.

> La base local de desarrollo tenía turnos de prueba corridos 3 h; se reseteó con tu OK.

## Decisiones tomadas en la fase

| Decisión | Motivo |
|---|---|
| El cliente puede **cancelar hasta la hora del turno**; reprogramar, hasta 3 h antes | Decisión del fundador al aprobar la fase: mejor que avise tarde a que no avise. |
| El staff puede agendar fuera de horario con confirmación | Pasa en la práctica (un cliente de confianza a última hora). Pisar otro turno sigue siendo imposible. |
| "Atendido" se marca a mano en esta fase | En la Fase 4 lo hará el cobro ("Cerrar servicio"). |
| Las señas todavía no se cobran | Llegan con Mercado Pago en la Fase 5. Los servicios con seña ya se reservan, sin seña por ahora. |
| Emails en HTML simple (no React Email) | Es texto claro y se entrega bien. React Email queda para cuando haya diseño de marca para los emails. |
| El precio y la duración de un turno quedan como se reservaron | P20: se cobra el precio reservado. Mover un turno no cambia su precio. |
| La semana arranca el lunes | Es lo habitual. Los días en que el barbero no trabaja se ven en gris. |
| Nueva migración `customer_merge` | Marca el registro fusionado (`merged_into_id`). La base impide fusionar un cliente consigo mismo. |

## Pendiente

- La lista real de servicios y el horario del local: te los pido en otra sesión.
- Staging en Railway: cuando esté el dominio.
- WhatsApp y recordatorios (24 h y 2 h): Fase 6.
