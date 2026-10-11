# 06 · Preguntas de producto

**Cómo responder:** alcanza con los números. Por ejemplo:

> "P1: estoicos.com.ar. P5: dos Point Smart 2 en la cuenta de la barbería. P6: número nuevo. P22: las propinas quedan para la casa. **El resto, los defaults.**"

Las preguntas del bloque A necesitan respuesta. Las demás ya tienen un **default propuesto**: si no decís nada, se usa ese.

## A. Necesito tu respuesta

| #      | Pregunta                                                                                                                                                                                                                                                            | Por qué importa                                                                                                               | Para cuándo        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **P1** | ¿Qué **dominio** vamos a usar (ej. `estoicos.com.ar`)? ¿Ya está en Cloudflare? ¿Tienen un sitio web en el dominio principal?                                                                                                                                        | Emails, cookies, links de reserva, webhooks. Propongo `app.` para el sistema y `api.` para webhooks.                          | Fase 1             |
| **P2** | Las **cuentas** de GitHub, Railway, Cloudflare y Resend, ¿las crean ustedes (recomendado, a nombre de la empresa) y me dan acceso?                                                                                                                                  | Son de la empresa, no mías. Sin ellas no puedo publicar el sistema.                                                           | Fase 1             |
| **P3** | ¿Confirmás **"Estoicos"** como nombre de la marca? ¿Cómo se llama la sucursal actual y cuál es su dirección?                                                                                                                                                        | Seed, emails, página de reservas.                                                                                             | Fase 1             |
| **P4** | ¿Qué usan **hoy** para turnos y clientes (app, planilla, cuaderno)? ¿Hay que **importar** clientes o turnos futuros?                                                                                                                                                | Define si hace falta un importador (CSV).                                                                                     | Fase 2             |
| **P5** | **Point:** ¿qué modelo o modelos tienen (Smart, Smart 2, Mini, Air, Pro)? ¿Cuántos por sucursal? ¿Están todos en **la cuenta de Mercado Pago de la barbería**, o algún barbero cobra con su propia cuenta?                                                          | La API de Orders solo documenta Point Smart 1 y 2. Si cada barbero cobra en su cuenta, el modelo de caja y comisiones cambia. | Antes de la Fase 5 |
| **P6** | **WhatsApp:** ¿usamos un **número nuevo** dedicado a notificaciones (recomendado) o el **número actual** del local (requiere contratar un partner de Meta)? ¿La empresa tiene cuenta de Meta Business verificada o los papeles para verificarla (CUIT, constancia)? | Pasar el número actual a la API sin partner lo borra de la app de WhatsApp Business y se pierde el historial.                 | Antes de la Fase 6 |
| **P7** | Las **transferencias** de clientes, ¿llegan a la cuenta de **Mercado Pago** o a una cuenta **bancaria**?                                                                                                                                                            | Solo lo que entra a MP se puede conciliar automáticamente.                                                                    | Fase 5             |

## B. Roles y caja

| #   | Pregunta                                        | Default propuesto                                                                                                                           |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| P8  | ¿Existe la figura de **encargado** de sucursal? | Sí: es un admin **limitado a su sucursal**. No ve otras sucursales ni toca la configuración general (Mercado Pago, puntos, notificaciones). |
| P9  | ¿Qué puede hacer el **barbero** con la caja?    | **Abrir** la caja y cobrar, sí. **Cerrarla, cargar egresos y anular ventas**, solo admin.                                                   |
| P10 | ¿Una caja por sucursal o una por barbero?       | **Una por sucursal.**                                                                                                                       |
| P11 | ¿El barbero ve la agenda de los demás?          | No, **solo la suya**.                                                                                                                       |
| P12 | ¿Quién puede hacer descuentos manuales?         | **Solo admin.** El barbero solo aplica canjes de puntos.                                                                                    |

## C. Agenda y reservas

| #   | Pregunta                                                                            | Default propuesto                                                                                                             |
| --- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| P13 | ¿Se pueden reservar **varios servicios en un turno** (corte + barba sin ser combo)? | Sí, con el mismo barbero. La duración y el precio se suman.                                                                   |
| P14 | ¿Ofrecemos **"cualquier barbero"** en la reserva online?                            | Sí. El sistema asigna el que tenga menos turnos ese día.                                                                      |
| P15 | Reglas de reserva online                                                            | Anticipación **mínima 60 min**, **máxima 30 días**, **máximo 2 turnos futuros** por cliente, reprogramar hasta **3 h antes**. |
| P16 | ¿Cuándo un turno pasa a **"confirmado"**?                                           | Cuando paga la seña, cuando el cliente toca **"Confirmo"** en el recordatorio, o cuando lo marca el staff.                    |
| P17 | ¿Exigimos **seña a quien ya faltó**?                                                | Queda configurable (ej. a partir de 2 ausencias, 50 % de seña). **Apagado** hasta que lo actives.                             |
| P18 | ¿Se puede atender y cobrar a alguien **sin registrarlo**?                           | Sí (atención sin turno y venta de mostrador), pero sin puntos ni historial.                                                   |
| P19 | ¿El precio puede **variar según el barbero** (senior o junior)?                     | No en la v1. Sí puede variar por sucursal.                                                                                    |
| P20 | Si el precio cambia entre la reserva y el día del turno, ¿qué se cobra?             | **El precio reservado.** El admin puede modificarlo al cobrar y queda auditado.                                               |
| P21 | ¿Hace falta **tiempo de limpieza** entre turnos?                                    | Se incluye dentro de la duración de cada servicio.                                                                            |

## D. Cobros, caja y stock

| #   | Pregunta                                                                          | Default propuesto                                                 |
| --- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| P22 | **Propinas:** ¿se registran? ¿de quién son?                                       | Se registran y son **100 % del barbero**. No suman puntos.        |
| P23 | ¿Se puede **pagar una venta con dos medios** (parte efectivo, parte Point)?       | Sí.                                                               |
| P24 | Si el sistema dice que no hay stock pero el producto está en el local, ¿se vende? | **Sí, con alerta** (stock negativo), para no frenar el mostrador. |
| P25 | ¿Se puede cobrar **sin abrir la caja**?                                           | **No:** primero se abre la caja.                                  |

## E. Comisiones

| #   | Pregunta                                                                         | Default propuesto                                                                                          |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| P26 | ¿Sobre qué se calcula la comisión?                                               | Sobre **lo cobrado en cada línea** (después de descuentos), **sin descontar** la comisión de Mercado Pago. |
| P27 | Si el cliente canjea un **corte gratis con puntos**, ¿el barbero cobra comisión? | **Sí, sobre el precio de lista.** Lo absorbe la barbería, para que los barberos apoyen el programa.        |
| P28 | Si el cliente **no viene** y se retiene la seña, ¿el barbero cobra algo?         | **No.**                                                                                                    |
| P29 | ¿Cada cuánto se liquidan las comisiones?                                         | **Semanal** por defecto, configurable por barbero (quincenal, mensual).                                    |
| P30 | ¿Hay comisiones en **monto fijo** por servicio (ej. $3.000 por corte)?           | No en la v1: solo porcentajes.                                                                             |

## F. Mercado Pago y señas

| #   | Pregunta                                                          | Default propuesto                                                                                                      |
| --- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| P31 | ¿Cómo se vincula la cuenta?                                       | El admin pega el token de **su propia** aplicación de MP (te guío paso a paso). OAuth queda para franquicias.          |
| P32 | Si el cliente cancela **a tiempo**, ¿qué pasa con la seña?        | Queda como **saldo a favor**, porque es inmediato y no tiene costo. El admin puede reintegrarla si el cliente lo pide. |
| P33 | Si **la barbería** cancela el turno                               | El cliente elige: reintegro o saldo a favor.                                                                           |
| P34 | ¿Cuánto tiempo tiene el cliente para pagar la seña?               | **15 minutos.**                                                                                                        |
| P35 | Si la seña se acredita **después** de que se liberó el turno      | Si el horario sigue libre, se confirma igual. Si no, pasa a saldo a favor y se avisa al admin.                         |
| P36 | ¿Cuánto espera el Point una orden antes de expirar?               | **10 minutos.**                                                                                                        |
| P37 | ¿Con cuánta anticipación hay que cancelar para no perder la seña? | **24 horas.**                                                                                                          |

## G. Notificaciones

| #   | Pregunta                              | Default propuesto                                                         |
| --- | ------------------------------------- | ------------------------------------------------------------------------- |
| P38 | ¿Cuándo van los **recordatorios**?    | **24 h y 2 h antes.**                                                     |
| P39 | Horario sin mensajes de **marketing** | **De 21 a 9 h.**                                                          |
| P40 | **Pedido de reseña en Google**        | **2 h después** del servicio, como máximo **1 cada 90 días** por cliente. |
| P41 | **Reactivación**                      | A las **5 semanas** sin venir. No se repite antes de 30 días.             |

## H. Puntos y recompensas

| #   | Pregunta                                                   | Default propuesto                                                                                                              |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| P42 | Regla general                                              | **1 punto cada $1.000.** Suman servicios y productos; las propinas no. _(Pasame tus números reales si ya los tenés pensados.)_ |
| P43 | Si se anula una venta cuyos puntos el cliente **ya gastó** | El saldo **puede quedar negativo** hasta que vuelva a sumar.                                                                   |
| P44 | ¿Vencen los puntos?                                        | **A los 12 meses.**                                                                                                            |
| P45 | Catálogo inicial de recompensas                            | Ejemplos para el seed: corte gratis, 10 % de descuento, un producto. _(Pasame el catálogo real con su costo en puntos.)_       |

## I. Clientes

| #   | Pregunta                                                           | Default propuesto                                                                                                  |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| P46 | ¿El email es obligatorio?                                          | **Opcional en el local** (sin email no hay portal, pero sí WhatsApp). **Obligatorio online**, porque es el acceso. |
| P47 | ¿Varios clientes pueden compartir teléfono (padres e hijos)?       | **Sí.** El teléfono no es único.                                                                                   |
| P48 | ¿Un padre puede gestionar desde su cuenta los turnos de sus hijos? | No en la v1: se agenda desde el local. Queda anotado para después.                                                 |

## J. Plan

| #   | Pregunta                                                                                                                                                                  | Default propuesto                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| P49 | ¿Empezamos a **usar el sistema en el local al terminar la Fase 4** (agenda, cobros, caja, stock y comisiones, con Point cargado a mano), antes de integrar MP y WhatsApp? | **Sí, como piloto** en la sucursal actual. |
