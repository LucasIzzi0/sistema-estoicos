# Fase 5 — Mercado Pago

**Fecha:** 28/09/2026
**Estado:** aprobada (28/09/2026), **a falta de la prueba con credenciales reales**.
Aplica tus respuestas del mismo día ([decisiones](../decisiones/2026-09-25-respuestas-de-producto.md)): seña online apagada, reintegros solo del dueño, una terminal en uso y la otra de repuesto, y desarrollo sin credenciales todavía.

> **Falta la prueba final con Mercado Pago de verdad.** Todo se construyó y se probó contra un **Mercado Pago simulado** que reproduce el comportamiento documentado. Cuando me pases las credenciales, valido contra el sandbox (con la terminal virtual de MP) y después con el Point real.

## Qué quedó hecho

| Módulo | Detalle |
|---|---|
| **Vincular la cuenta** | El dueño pega el Access Token y la clave de webhooks de su aplicación de Mercado Pago, con el paso a paso en pantalla. Se guardan **cifrados** (AES-256-GCM): no se loguean, no viajan al navegador y no se vuelven a mostrar. El token se **prueba antes de guardarlo**. Desvincular borra el token guardado. |
| **Terminales Point** | Se traen de Mercado Pago, se les pone nombre y sucursal, y se activan en **modo PDV** desde el sistema (después hay que **reiniciar la terminal**: es regla de MP). Una queda en uso y la otra de repuesto, como pediste. |
| **Cobro con Point** | Desde la pantalla de cobro: se manda el monto a la terminal y se ve el estado **en vivo** (“Enviado al Point” → “El cliente está pagando” → “Aprobado”). Se puede cobrar una parte con el Point y el resto con otro medio. El sistema recuerda la última terminal usada. |
| **Cancelar** | Mientras la terminal no tomó el cobro, se cancela desde el sistema. Cuando el cliente ya está pagando, la pantalla lo dice: **se cancela desde la terminal** (regla de MP). |
| **Rechazos y vencimientos** | Si el cobro se rechaza se muestra el motivo, la venta **queda abierta** y se puede reintentar (cada intento lleva su propia referencia). Si nadie paga, la orden vence y libera la terminal. |
| **Una orden por terminal** | Lo impide la base, no solo la app: dos cobros a la vez en la misma terminal dan un error claro. |
| **Webhooks** | **Siempre se valida la firma**; si no valida, 401 y aviso en el panel. Cada aviso se registra una sola vez (idempotencia), se responde al instante y el trabajo real va a la cola. **Nunca se cree lo que dice el webhook**: el sistema le pregunta a Mercado Pago el estado real. |
| **Redes de seguridad** | Si el webhook no llega, la pantalla confirma igual al consultar el estado; un barrido cada 2 minutos revisa los cobros sin noticias y reencola los avisos trabados; cada 10 minutos se sincronizan todos los pagos de la cuenta. Si algo falla, aparece una alerta en el panel. |
| **Pagos sin asignar** | Todo pago que entra a la cuenta termina atado a una venta, marcado como otro ingreso, cargado como saldo a favor de un cliente o ignorado con motivo. La bandeja **sugiere** candidatos (mismo monto, ±15 min, misma sucursal), pero decide una persona y **queda auditado**. Los cobros con Point se vinculan solos. |
| **Reintegros** | **Solo el dueño.** Al medio original (se lo pide a Mercado Pago) o como **saldo a favor** del cliente, que es inmediato. El sistema avisa si Mercado Pago ya no permite devolver (90 días para Point, 180 para pagos online) y ofrece el saldo a favor. Un reintegro en efectivo sale de la caja abierta. |
| **Seña online** | **Apagada**, como pediste. El circuito está completo: retención del horario, vencimiento que libera el turno, pago que llega tarde (se reactiva el turno si el horario sigue libre, o queda como saldo a favor con aviso) y cancelación según la política configurada. Se prende desde configuración, sin tocar código. |
| **Sin credenciales** | En desarrollo hay un **Mercado Pago simulado** (`MP_SIMULATED`) con botones para hacer de terminal: el cliente toma el cobro, paga o lo rechaza. Nunca existe en producción. |

## Verificación

- **208 tests en verde** (antes 172):
  - 12 de la **firma de los webhooks**: válida, alterada, sin header, con otra clave, id alfanumérico en cualquier capitalización, y `ts` viejo (se acepta a propósito: Mercado Pago reintenta y descartarlo perdería pagos).
  - 24 de integración, entre ellos:
    - El token se guarda cifrado y **no aparece en ninguna respuesta**.
    - Un token que Mercado Pago rechaza **no se guarda**.
    - El mismo webhook tres veces → **un cobro, una comisión, una venta**.
    - Al aprobarse el cobro: venta cobrada, comisiones y turno atendido.
    - Dos cobros a la vez en la misma terminal: uno solo.
    - Rechazo, cancelación (y el caso “ya no se puede, seguí desde la terminal”) y vencimiento.
    - Pago suelto → bandeja con sugerencias → asignado → venta cobrada y auditada.
    - Pagos rechazados que no molestan en la bandeja.
    - Reintegros: solo el dueño, al medio original, a saldo a favor, y el freno a devolver de más.
- **Recorrido completo en el navegador** (14 pasos, todos OK): vincular la cuenta → traer terminales → activar el modo PDV → armar la venta → mandarla al Point → ver “el cliente está pagando” → aprobado y venta cobrada → cobro rechazado y reintento → devolver un cobro → bandeja de pagos → pantalla en el celular.
- **Los datos cierran** (verificado en la base): cuenta activa con token cifrado, orden aprobada y orden rechazada, comisión de $7.500, reintegro registrado, el pago con Point vinculado solo, y la auditoría con las cuatro acciones sensibles.
- Lint, tipos (8 paquetes) y `next build` OK.

## Decisiones y hallazgos de la fase

| Decisión | Motivo |
|---|---|
| La pantalla de cobro **confirma la venta al consultar el estado**, sin esperar el webhook | Encontrado probando: si el webhook tarda, quien cobra no puede quedarse mirando una pantalla que dice “esperando”. Ahora responde apenas Mercado Pago dice que aprobó. |
| El pago con Point se registra en el espejo **al instante** | Antes aparecía recién con la sincronización de 10 minutos. Encontrado revisando los datos después del recorrido. |
| Una orden rechazada marca su cobro como rechazado **en el mismo paso** | **Bug encontrado por los tests:** el cobro quedaba “pendiente” para siempre y la terminal seguía ocupada. |
| El `external_reference` lleva el número de intento (`sale_<id>_2`) | Mercado Pago lo exige único por orden; si un cobro se rechaza y se reintenta, no se puede repetir. |
| El vuelto y los montos parciales conviven | Se puede mandar una parte al Point y cobrar el resto en efectivo. |
| No se rechaza un webhook por ser viejo | Mercado Pago no documenta si sus reintentos reusan la marca de tiempo; descartarlos podría perder un pago. No hace falta: nada se cree y todo es idempotente. |
| El simulador vive en `packages/integrations` | Es la misma interfaz que el cliente real, así que el día que haya credenciales no cambia una línea del negocio. |

## Pendiente

- **Credenciales de Mercado Pago**: validar en sandbox con la terminal virtual y después con el Point real (riesgos R1 y R5 del plan).
- Confirmar con una cuenta real si las **transferencias entrantes y los QR estáticos** aparecen en la búsqueda de pagos; si no, se suma un importador desde los reportes de MP (ya está previsto).
- El **MCP oficial de Mercado Pago** no está conectado en esta sesión; el trabajo se hizo con el diseño documentado en la Fase 0.
- La lista real de servicios y el horario del local.
- Notificaciones por WhatsApp: Fase 6. Puntos: Fase 7. Reportes completos: Fase 8.
