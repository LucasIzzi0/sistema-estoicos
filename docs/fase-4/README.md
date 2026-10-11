# Fase 4 — Caja, ventas, stock, egresos y comisiones

**Fecha:** 28/09/2026
**Estado:** aprobada (28/09/2026).
Aplica tus respuestas del 25/09 ([decisiones](../decisiones/2026-09-25-respuestas-de-producto.md)): propinas para la casa, resumen imprimible para el barbero, 4 medios de pago, y cierre de caja y descuentos solo del dueño o el encargado.

Con esta fase **se puede operar un día completo**: abrir la caja, atender, cobrar, cargar gastos y cerrar con arqueo.

## Qué quedó hecho

| Módulo | Detalle |
|---|---|
| **Cobro desde la agenda** | El turno tiene botón **Cobrar**: arma la venta con los servicios **al precio reservado** (P20). Dos clics no crean dos ventas. Al cobrar, el turno pasa solo a **Atendido**. |
| **Venta de mostrador** | Sin turno: productos, servicios y propina. El cliente es opcional (P18); si se registra, queda en su historial. |
| **Armado de la venta** | Sumar productos (el mismo producto se agrupa y sube la cantidad), servicios y propina. **Descuento por línea** con % rápidos (10, 20, 50, 100) y motivo obligatorio: **solo dueño o encargado** (P12), y queda auditado. |
| **Cobro** | Un solo paso, hasta **4 medios** (P23): efectivo, transferencia, Point y QR/otro posnet. El efectivo calcula el **vuelto**. Los pagos tienen que sumar justo. **Todo o nada**: si algo falla, no queda ningún cobro a medias. |
| **Doble clic seguro** | Cobrar y anular llevan una clave única: el mismo pedido repetido (doble clic, mala señal) **no cobra dos veces** y devuelve la misma respuesta. |
| **Al cobrar, en una sola transacción** | Turno → Atendido · comisiones por línea · descuento de stock · primera y última visita del cliente. O pasa todo, o no pasa nada. |
| **Anulación** | No se borra nada: se reintegra cada cobro (el efectivo sale de la caja abierta), se revierten las comisiones y **vuelve el stock**. Con motivo obligatorio y auditado. Solo dueño o encargado. |
| **Caja diaria** | Una por sucursal (P10). **Sin caja abierta no se cobra** (P25). Recepción la abre y cobra. Aportes y retiros de efectivo, egresos pagados con la caja, y **cierre con arqueo por medio de pago**: esperado vs contado, con la diferencia y su motivo. Historial de cajas con las diferencias. |
| **Egresos** | Del mes, con categoría, proveedor y medio. De la caja o pagados aparte (alquiler, servicios). Los generales (sin sucursal) solo los carga el dueño. Anulables con motivo. |
| **Resultado del mes** | Lo cobrado − reintegros − egresos, por medio de pago y por categoría. Aparte: comisiones generadas, cuánto falta pagar y el costo de los productos vendidos. |
| **Stock por sucursal** | Se descuenta solo al cobrar. **Compras** (actualizan el costo), **ajustes con motivo obligatorio** (recuento, rotura, uso interno), **mínimo por producto** con alerta y aviso al cobrar. Historial completo de cada producto. Se puede vender sin stock (P24) y queda la alerta. |
| **Comisiones** | Se generan al cobrarse la venta. Tasa: barbero+servicio → servicio → barbero (productos: producto → barbero). Base: lo cobrado **después del descuento**. Redondeo al centavo hacia abajo. **Las propinas no generan comisión** (quedan para la casa). |
| **Liquidaciones** | Pendiente por barbero con el detalle. Al liquidar entra todo lo no liquidado hasta la fecha (también las reversas de ventas anuladas). Marcarla pagada **crea el egreso** en "Comisiones" y, si sale de la caja, descuenta del esperado. Anularla devuelve todo a pendiente. |
| **Resumen para el barbero** | Página imprimible (o PDF para WhatsApp) con el detalle, los totales y espacio para firmar. Los barberos **no entran al sistema**: reciben este papel. |
| **Ficha del cliente** | Se sumó el historial de **pagos**: ventas cobradas y anuladas con sus medios de pago. |

## Verificación

- **172 tests en verde** (antes 148):
  - 9 de cálculo puro: prioridad de comisiones, redondeo al centavo, base después de descuentos, totales y esperado de caja.
  - 15 de integración, entre ellos:
    - **Doble clic en "Cobrar"**: dos pedidos simultáneos con la misma clave → **un solo cobro**.
    - Los pagos tienen que sumar justo; si no, no queda nada registrado.
    - **5 ventas simultáneas** del mismo producto → el stock descuenta exacto y sin números de venta repetidos.
    - Al cobrar: turno atendido, comisiones correctas (la propina no genera), stock y última visita.
    - Esperado de caja con egreso y retiro; cierre que exige contar todos los medios con movimiento.
    - Anulación: reintegros, reversas que suman cero y stock de vuelta.
    - Permisos: recepción no retira efectivo, no descuenta, no cierra caja, no anula y no ve comisiones ni reportes.
  - La matriz de permisos ahora recorre también las 30 rutas nuevas.
- **Recorrido completo en el navegador** (19 pasos, todos OK), con los 3 servicios levantados: abrir caja → agendar → cobrar desde el turno con producto, propina y descuento → cobro dividido con vuelto → venta de mostrador → stock (compra, ajuste, historial) → egreso y retiro → liquidar y pagar comisiones → resumen imprimible → cierre con arqueo → resultado del mes → ficha del cliente → caja en el celular.
- **Los números cierran** (verificado en la base): efectivo esperado $16.100, arqueo con −$100 a propósito, comisiones $8.900 ($6.750 + $1.200 + $950), stock exacto y resultado del mes $25.600.
- Lint, tipos (8 paquetes) y `next build` OK.

## Decisiones tomadas en la fase

| Decisión | Motivo |
|---|---|
| El vuelto se calcula en pantalla pero **no se registra** | Lo que entra a la caja es lo cobrado; el vuelto ya está descontado. |
| En una venta de mostrador, el vendedor del producto arranca en **"Nadie"** | Preseleccionar un barbero asignaba comisión sin que nadie la eligiera. Si la venta viene de un turno, queda ese barbero. |
| Anular una venta **no reabre el turno** | El turno ya se atendió. Si hay que volver a cobrar, se hace una venta de mostrador. |
| "Atendido" ahora lo marca el cobro | En la Fase 3 se marcaba a mano; el botón quedó solo para deshacer. |
| Una liquidación toma **todo lo pendiente** hasta la fecha, no solo el período | Si algo quedó de un período anterior (por ejemplo una venta anulada), se arrastra solo y no se pierde. |
| Las comisiones se pagan **desde la liquidación**, no como egreso suelto | Así el egreso siempre queda atado a su liquidación y no se puede duplicar. |
| Los egresos pagados con una caja **ya cerrada** no se pueden anular | Cambiarían un arqueo ya firmado. |
| Cada conexión a la base fija su zona horaria en UTC | Arreglo de la Fase 3, ahora con test propio. |

## Pendiente

- La lista real de servicios y el horario del local: te los pido en otra sesión.
- **Piloto en el local** (P49): con esto ya se puede operar, con el Point cargado a mano.
- Mercado Pago integrado (Point y señas): Fase 5. WhatsApp y recordatorios: Fase 6. Puntos: Fase 7. Reportes completos y CSV: Fase 8.
