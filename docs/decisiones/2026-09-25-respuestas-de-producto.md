# Respuestas de producto (25/09/2026)

Respuestas del fundador a las preguntas de la Fase 0 ([06-preguntas.md](../fase-0/06-preguntas.md)) y a las que surgieron en la Fase 1. Lo que no figura acá usa el default propuesto.

| Tema                                | Decisión                                                             | Impacto                                                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fase 0 y Fase 1                     | Aprobadas                                                            | Se avanza a la Fase 2                                                                                                                                     |
| Dominio (P1)                        | Todavía no hay: hay que comprarlo                                    | Staging en Railway queda pendiente; se sigue en local                                                                                                     |
| Sistema actual (P4)                 | Ninguno: es una barbería nueva                                       | **No hace falta importador** de clientes                                                                                                                  |
| Precio por barbero (P19)            | No: mismo precio para todos                                          | El precio solo varía por sucursal                                                                                                                         |
| Encargado (P8)                      | Sí, a futuro                                                         | Rol ADMIN limitado a su sucursal, disponible                                                                                                              |
| Email del cliente en el local (P46) | **Obligatorio**                                                      | El alta rápida exige email. Solo la atención sin turno y la venta de mostrador pueden no tener cliente.                                                   |
| DNI                                 | Opcional                                                             | Campo opcional y buscable                                                                                                                                 |
| Lista de servicios                  | Se pasa más adelante                                                 | Se usan servicios de ejemplo                                                                                                                              |
| Horario del local                   | A definir                                                            | Martes a sábado de 10 a 20 como ejemplo, editable                                                                                                         |
| **Acceso de los barberos**          | **Ninguno: no entran al sistema** (riesgo de que se lleven clientes) | Se elimina el panel del barbero y el rol BARBER de usuario. El barbero es solo un perfil (agenda, horarios, servicios, comisiones) que gestiona el admin. |
| Quién opera el local                | Dueño o encargado; **recepcionista a futuro**                        | Se agrega el rol RECEPTION (agenda, clientes y cobro; sin finanzas, configuración ni reportes), oculto hasta que se use                                   |

## Cambios respecto del pedido original

- El pedido original tenía un panel para barberos ("Mi Agenda, Cobrar, Mis Clientes, Mis Comisiones") y el rol BARBER con acceso. Por decisión del fundador los barberos **no tienen usuario**. Las comisiones las ve y liquida el admin.
- Si en el futuro se quiere un acceso mínimo para barberos (agenda del día sin datos de contacto), el modelo lo permite: `barbers.membership_id` sigue existiendo y es opcional.

## Respuestas para la Fase 3 (agenda y reservas)

| Tema | Decisión |
|---|---|
| Fase 2 | Aprobada |
| Varios servicios en un turno (P13) | Sí, con el mismo barbero (se suman duraciones y precios) |
| "Cualquier barbero" online (P14) | Sí: se asigna el barbero con menos minutos reservados ese día |
| Reglas de reserva online (P15) | Mínimo 60 min antes, hasta 30 días adelante, máximo 2 turnos futuros por cliente, reprogramar hasta 3 h antes, turnos cada 15 min |

## Cierre de la Fase 3

| Tema | Decisión |
|---|---|
| Fase 3 | Aprobada |
| Cancelación online del cliente | **Hasta la hora del turno** (mejor que avise tarde a que no avise). Reprogramar sigue siendo hasta 3 h antes. |
| Base local de desarrollo | Reseteada con tu OK (tenía turnos de prueba corridos 3 h por el bug de zona horaria ya corregido). |

## Respuestas para la Fase 4 (caja, cobros, stock y comisiones)

| Tema | Decisión |
|---|---|
| Propinas | **Quedan para la casa** (respuesta P22 de la Fase 0): el % de propinas de los barberos arranca en 0. |
| Comisiones de los barberos (no usan el sistema) | Al liquidar, un **resumen imprimible** por barbero (servicios, totales y comisión) para imprimir o mandar por WhatsApp. |
| Medios de pago | **Efectivo** (entra al arqueo), **transferencia / alias**, **Point de Mercado Pago** (cargado a mano hasta la Fase 5) y **QR / otro posnet**. |
| Cierre de caja | Solo **dueño o encargado**. Recepción abre y cobra. |
| Descuentos | Solo **dueño o encargado** (P12). Los canjes de puntos los aplica cualquiera. |

## Cierre de la Fase 4 (28/09/2026)

| Tema | Decisión |
|---|---|
| Fase 4 | Aprobada |
| Venta de mostrador: vendedor del producto | Arranca en **"Nadie"**: la comisión de un producto se asigna solo si alguien la elige. Si la venta viene de un turno, queda el barbero del turno. |
| Vuelto | Se calcula en pantalla, no se registra (lo que entra a la caja es lo cobrado). |

## Respuestas para la Fase 5 (Mercado Pago) — 28/09/2026

| Tema | Decisión |
|---|---|
| Fase 5 | Aprobada |
| **Seña online** | **Apagada por ahora.** Se construye y se prueba completa, pero nadie paga seña hasta que la prendas desde configuración. |
| Credenciales de MP | Todavía no hay: se construye y se prueba contra un **Mercado Pago simulado**. Falta validar en sandbox (terminal virtual) y con el Point real. |
| Reintegros desde el sistema | **Solo el dueño.** El encargado y recepción anulan ventas, pero devolver plata de Mercado Pago es del dueño. Queda auditado. |
| Terminales Point | **Una activa** en la sucursal actual; la segunda queda cargada **de repuesto**. |

## Cierre de la Fase 5 (28/09/2026)

| Tema | Decisión |
|---|---|
| Fase 5 | Aprobada. Queda pendiente validar con credenciales reales (sandbox y Point). |

## Respuestas para la Fase 6 (WhatsApp y notificaciones) — 28/09/2026

| Tema | Decisión |
|---|---|
| Recordatorios | **24 h y 2 h antes** del turno. |
| Botones del recordatorio | **Confirmar y cancelar** con un toque: el que no puede avisa y se libera el horario (P16). |
| Marketing | **Sí**: pedido de reseña en Google (2 h después, máx. 1 cada 90 días) y reactivación del que no vuelve (a las 5 semanas, sin repetir antes de 30 días). Ambos respetan el consentimiento y la franja sin mensajes. |
| WhatsApp | Todavía no hay número ni plantillas aprobadas: se construye y prueba contra un **WhatsApp simulado**. Mientras tanto **todo sale por email**. |

## Cierre de la Fase 6 (28/09/2026)

| Tema | Decisión |
|---|---|
| Fase 6 | Aprobada. Queda pendiente el alta del número en Meta y la aprobación de las plantillas. |

## Respuestas para la Fase 7 (puntos y recompensas) — 28/09/2026

| Tema | Decisión |
|---|---|
| Corte gratis | **Cada 8 cortes** (el cliente paga 8 y el siguiente es gratis). Con la regla de 1 punto cada $1.000 y el corte a $15.000, son **120 puntos**. |
| Vencimiento | **12 meses** desde que se ganan. |
| Catálogo | Corte gratis, **barba o perfilado gratis**, **20 % de descuento** y **un producto de regalo**. |
| Arranque | **Prendido** desde la primera venta. |

## Cierre de la Fase 7 (28/09/2026)

| Tema | Decisión |
|---|---|
| Fase 7 | Aprobada. |
| Catálogo | Se saca la recompensa "10 % de descuento" que había quedado de una prueba: quedan las 4 acordadas. |

## Respuestas para la Fase 8 (dashboard, reportes y export) — 28/09/2026

| Tema | Decisión |
|---|---|
| Alcance | La Fase 8 es **solo los números**: dashboard, reportes y export. La **salida a producción** (dominio, backups, monitoreo externo, revisión de seguridad) pasa a ser la **Fase 9**, porque hoy depende del dominio y de credenciales que todavía no están. |
| Dashboard | Entran los cuatro bloques: plata del día, turnos del día, clientes nuevos vs. recurrentes y alertas. El orden lo define el criterio profesional: primero los indicadores del día, después la agenda, después las alertas y al final la tendencia de clientes. |
| Export | **Solo el dueño**, y cada export queda auditado (qué se bajó, cuándo y quién). |
| Segundo factor | **Todavía no.** Queda listo en el código y se prende desde Configuración cuando el dueño quiera. |

## Catálogo real y identidad (29/09/2026)

El fundador pasó la lista de precios del local.

Corregido el 29/09 con lo que respondió Ulises (socio):

| Servicio | Precio | Duración |
|---|---|---|
| Corte (incluye el perfilado de cejas) | $25.000 | 1 h |
| Barba | $15.000 | 1 h |
| Corte y barba | $28.000 | 1 h |
| Toalla caliente (corte + arreglo de barba + perfilado, con toalla caliente) | $35.000 | 1 h |
| Corte niño | $25.000 | 1 h |

**El local:** **Sucursal Principal Freire**, Ramón Freire 2411, Belgrano, CABA.

**Horario** (lo pasó Ema): **martes a sábado de 11 a 20**. Domingo y lunes, descanso. Si cae alguien a última hora se estira a mano desde la agenda.

> La URL pública de reservas sigue siendo `/reservar/principal`: el nombre de la sucursal cambió, el link no, así que lo que ya esté compartido o impreso sigue funcionando.

| Tema | Decisión |
|---|---|
| Corte niño | **Vale lo mismo que el de adulto** ($25.000). Se deja como servicio aparte solo para saber cuántos son. |
| Perfilado de cejas | **Va incluido en el corte**: se archiva como servicio suelto. |
| Duración de los turnos | **Una hora para todo.** Ulises avisó que cualquier servicio puede llevar hasta una hora según el barbero; bloqueando la hora completa el que sigue nunca espera. Entran 9 turnos por barbero por día. |
| Puntos | Con el corte a $25.000 un corte da 25 puntos, así que **el corte gratis pasa de 120 a 200 puntos** para que siga cayendo a los 8 cortes. La barba gratis, de 72 a 120. El 20 % de descuento queda en 40. |
| Identidad | **Azul medio oscuro, negro y dorado.** Lo que ve el cliente (inicio, reserva, su cuenta) va en oscuro con dorado, como el cartel. El panel de trabajo queda claro, con el azul como color principal y el dorado en los detalles: se lee mejor ocho horas seguidas. |

> **Nota del entorno (29/09/2026):** el proyecto vive en `~/Documents`, que en esta Mac está sincronizada con iCloud. Eso viene rompiendo cosas: archivos duplicados (`... 2.json`) y archivos de `node_modules` que quedan ilegibles y tiran abajo el entorno de desarrollo. Conviene mover el proyecto fuera de Documents (por ejemplo a `~/dev/`) o sacar esa carpeta de iCloud.
