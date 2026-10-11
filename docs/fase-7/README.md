# Fase 7 — Puntos y recompensas

**Fecha:** 28/09/2026
**Estado:** terminada, esperando tu aprobación.
Aplica tus respuestas del 25/09 ([decisiones](../decisiones/2026-09-25-respuestas-de-producto.md)): **corte gratis cada 8 cortes**, los puntos **vencen a los 12 meses**, catálogo con producto de regalo + 20 % de descuento + barba gratis, y el programa **prendido desde el arranque**.

## Cómo quedó la regla

**1 punto cada $1.000 de gasto.** Con el corte a $15.000, son 15 puntos por corte y el **corte gratis cuesta 120 puntos**: exactamente 8 cortes. Si mañana cambiás el precio del corte, el premio sigue llegando a los 8 cortes sin tocar nada, porque los puntos siguen a la plata, no a la cantidad de visitas.

| Recompensa | Puntos | Equivale a |
|---|---|---|
| 20 % de descuento | 40 | ~2,7 cortes |
| Barba o perfilado gratis | 72 | ~4,8 cortes |
| Cera mate de regalo | 96 | ~6,4 cortes |
| Corte gratis | 120 | 8 cortes |

Todo esto se cambia desde la pantalla, sin tocar el código.

## Qué quedó hecho

| Módulo | Detalle |
|---|---|
| **Ledger de puntos** | El saldo **es la suma de los movimientos**: nunca se edita un número, se agregan filas. La base **bloquea editar y borrar** (trigger de solo inserción), así que el historial no se puede maquillar. |
| **Acreditación** | Los puntos se suman **cuando la venta queda pagada**, en la misma transacción que las comisiones y el stock. Las **propinas nunca suman**. Cada venta tiene su clave: un doble clic o un webhook repetido no acredita dos veces. |
| **Vencimiento** | A los 12 meses. Un job diario (3:30 AM) los vence solo. La cuenta es idempotente: **correrlo dos veces el mismo día no vence de más**. |
| **Canje en el cobro** | En la pantalla de la venta aparece el saldo del cliente y los botones de lo que puede pedir. Se aplica sobre una línea (el corte gratis descuenta ese corte) y se puede **deshacer** antes de cobrar. |
| **Venta en $0** | Si el canje deja la venta en cero, se cierra con un botón que dice **"la pagó con puntos"**, sin inventar un cobro de $0. |
| **El barbero no pierde** | Si el cliente paga el corte con puntos, la **comisión del barbero se calcula sobre el precio de lista** (configurable). Era la decisión P27 y no estaba aplicada: el barbero cobraba $0 por un corte gratis. |
| **Anulación** | Anular una venta revierte los puntos ganados **y devuelve los canjeados**. Si el cliente ya los gastó, el saldo puede quedar en negativo: es la verdad y se ve. |
| **Ajuste manual** | Solo el dueño, **con motivo obligatorio**, y queda auditado con su nombre. Se hace desde la ficha del cliente. |
| **Aviso al cliente** | Al acreditarse los puntos le llega el mensaje con cuánto sumó, cuánto tiene y qué le falta para lo que sigue (por email, o WhatsApp cuando esté el número). |
| **Pantallas** | *Puntos y Recompensas* (reglas + catálogo), **puntos en la ficha del cliente** (saldo, movimientos y ajuste) y **"Mis puntos"** en la cuenta del cliente (saldo, qué puede pedir, cuánto le falta e historial). |

## Verificación

- **280 tests en verde** (antes 242):
  - 19 de cálculo puro: cuántos puntos da una venta, vencimiento, saldo, descuento de cada tipo de recompensa.
  - 19 de integración de esta fase: acreditación (propina no, producto sí, venta sin cliente no), canje sin saldo, canje que deja la venta en $0, **dos canjes simultáneos con saldo para uno solo** (entra uno, el otro se rechaza), anulación con puntos ya gastados, **vencimiento FIFO corrido dos veces**, ledger que la base no deja editar ni borrar, permisos (recepción no ajusta) y el portal del cliente.
- **Recorrido en el navegador**, con los números verificados contra la base: cargar puntos desde la ficha → armar una venta → canjear el corte gratis ($15.000 → $0) → cerrar la venta → cobrar otra en efectivo y ver **+15 puntos** → entrar como cliente y ver "Mis puntos".
- Lint, tipos (8 paquetes) y `next build` OK.

## Bugs reales que encontraron los tests

| Qué pasaba | Por qué importaba |
|---|---|
| Una venta que quedaba en **$0 por un canje no se podía cerrar** | El corte gratis dejaba la venta abierta para siempre: no cerraba la caja ni pagaba la comisión. |
| **Deshacer un canje devolvía plata de menos** | El descuento se recalculaba sobre el precio ya rebajado (20 % de $12.000 en vez de los $3.000 puestos) y el corte volvía a $14.400 en lugar de $15.000. Ahora el canje **guarda cuánto descontó**. |
| El **barbero cobraba $0 de comisión** en un corte pagado con puntos | Contra tu decisión P27: el programa de puntos le salía del bolsillo al barbero. |
| **Dos ajustes manuales en el mismo instante chocaban** | El segundo fallaba en silencio y el dueño creía haberlo hecho. |

## Pendiente

- La lista real de servicios y el horario del local (sigue pendiente de fases anteriores).
- Número de WhatsApp aprobado en Meta y credenciales de Mercado Pago.
- Reportes completos y export: Fase 8.
