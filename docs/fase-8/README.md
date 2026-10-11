# Fase 8 — Dashboard, reportes y export

**Fecha:** 28/09/2026
**Estado:** terminada, esperando tu aprobación.
Aplica tus respuestas del mismo día: entran los cuatro bloques del dashboard, **solo el dueño** puede bajar planillas y el segundo factor queda listo pero apagado. La **salida a producción pasa a ser la Fase 9**, porque depende del dominio y de credenciales que todavía no están.

## Qué ves al entrar

El dashboard está ordenado como se mira el negocio a la mañana:

1. **La plata del día**: cuánto entró hoy, el ticket promedio, cuánto efectivo debería haber en la caja y cuántos turnos hay. Abajo, cómo entró (efectivo, transferencia, Point, QR), cómo viene la semana y **el mes comparado con los mismos días del mes pasado**.
2. **Lo que viene hoy**: los próximos turnos con hora, cliente, servicio y barbero, y cuántos faltaron.
3. **Para resolver**: ventas que quedaron abiertas de días anteriores, cajas sin cerrar, cobros de Mercado Pago sin asignar, productos que se están acabando y mensajes que fallaron. Cada línea es un link al lugar donde se arregla.
4. **Ocupación de cada barbero** (cuánto de su jornada tiene reservado) y **clientes nuevos vs. los que vuelven** en el mes.

## Reportes

Una pantalla con **rango de fechas** (atajos: hoy, últimos 7 días, este mes, mes pasado) y filtro por sucursal:

| Bloque | Qué muestra |
|---|---|
| **Resumen** | Cobrado, ticket promedio, clientes atendidos y resultado del período. |
| **Cómo se cobró** | Por medio de pago, más cuánto se hizo de descuentos sobre el precio de lista. |
| **De dónde sale el resultado** | Cobrado − comisiones − costo de los productos − egresos, con el detalle por categoría de gasto. |
| **Cada barbero** | Servicios hechos, cuánto facturó, su comisión, las propinas que generó (que quedan para la casa) y cuántos le faltaron. |
| **Lo más vendido** | Servicios y productos, ordenados por plata. |
| **Puntos y recompensas** | Puntos que sumaron, canjeados y vencidos, y cuánto costó en plata lo que se regaló. |

## Export a Excel

Cinco planillas: ventas, comisiones, egresos, clientes y movimientos de puntos. **Solo las ve y las baja el dueño**, y **cada bajada queda auditada** con tu nombre, qué bajaste, de qué fechas y cuántas filas.

Los archivos están hechos para **Excel en español**: separador punto y coma, coma decimal y acentos que se ven bien. Además, una celda que empiece con `=` se neutraliza, para que una planilla nunca ejecute nada.

## Verificación

- **320 tests en verde** (antes 280):
  - 19 de cálculo puro: ocupación, ticket promedio, comparación con el período anterior, días del rango, nuevos vs. recurrentes y el formato del CSV (comillas, fórmulas neutralizadas, coma decimal, BOM).
  - 21 de integración, armando **un día real de la barbería** (tres ventas, dos barberos, tres medios de pago, un gasto) y verificando cada número contra la base.
  - **El criterio de la fase se cumple**: el efectivo que muestra el dashboard es exactamente el que espera el cierre de caja.
- **Recorrido en el navegador**: dashboard con los números del día, reportes por rango y una planilla bajada y abierta.
- Lint, tipos (8 paquetes) y `next build` OK.

## Bugs y decisiones de la fase

| Qué pasaba | Cómo quedó |
|---|---|
| El efectivo del dashboard **no descontaba los gastos pagados en efectivo** | Daba distinto del cierre de caja, que es justamente el número con el que se controla. Ahora usa la misma fórmula. |
| "Clientes atendidos" se contaba **por turnos** | En el mostrador se cobra mucho sin turno previo y esos clientes no aparecían. Ahora se cuentan por ventas cobradas. |
| El ledger de puntos se fechaba con **el reloj de la base**, no con el de la aplicación | El resto del sistema usa el reloj de la app; un movimiento podía caer en otro día en un reporte por fechas. |
| El proxy de la web **descartaba el nombre del archivo** al bajar | La planilla bajaba sin su nombre ni las fechas. |
| Una fecha suelta se mostraba **un día antes** | "2026-09-28" se interpretaba como medianoche universal y, pasada a la hora de acá, retrocedía un día. Se veía en el título de los reportes. |
| Con **una sola sucursal**, el efectivo en caja decía "sin caja abierta" | Había que filtrar por sucursal para ver un número que es el único posible. Ahora, si hay una sola, se asume esa. |

## Pendiente

- La lista real de servicios y el horario del local.
- Número de WhatsApp aprobado en Meta y credenciales de Mercado Pago.
- **Fase 9 — salida a producción**: entorno real, backups con prueba de restauración, segundo factor, rol de base con mínimo privilegio, monitor externo, tests end-to-end, checklist de Cloudflare y revisión de seguridad.

## Anexos

- [Pasada de diseño](diseno.md) — qué cambió en la interfaz y por qué (29/09/2026).

## Preparado para la Fase 9

Dos piezas que no dependen del dominio ni de credenciales ya quedaron escritas:

- `infra/backup.sh` — copia de la base **y prueba de restauración**: restaura la copia en una base descartable y cuenta las filas de las tablas críticas. Si no se puede restaurar, termina con error. Un backup que nunca se probó no es un backup.
- `infra/rol-aplicacion.sql` — rol de base con el mínimo privilegio: puede leer y escribir filas, pero **no borrar ni alterar tablas**, y no puede borrar filas de los libros (puntos, comisiones, auditoría). Las migraciones se siguen aplicando con el usuario dueño, solo durante el deploy.
