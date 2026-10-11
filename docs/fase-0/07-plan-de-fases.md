# 07 · Plan de fases (ajustado)

## Qué cambié respecto del orden propuesto, y por qué

| Ajuste                                                                                                         | Motivo                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Publicar en Railway desde la Fase 1** (staging con Cloudflare, dominios y Resend), no recién en la Fase 8 | Los problemas de infraestructura (cookies, dominios, Cloudflare, red privada, extensión `btree_gist`) son baratos de arreglar al principio y caros al final. Además, cada fase se puede revisar en una URL real. |
| **2. En la Fase 1 entran el email (Resend) y el esqueleto del worker**                                         | El login de clientes es por código de email, así que el email tiene que funcionar desde el día 1. El worker nace con su latido y sus alertas, así la confiabilidad no queda para el final.                       |
| **3. El alta rápida de clientes pasa a la Fase 2**, antes de la agenda                                         | Para agendar hay que tener clientes. La ficha completa (historial de servicios y pagos) se completa en las Fases 3 y 4, cuando esos datos existen.                                                               |
| **4. La base de notificaciones (solo email) entra en la Fase 3**                                               | Así las reservas online mandan confirmación y cancelación desde que existen. La Fase 6 suma WhatsApp, recordatorios, reactivación, reseñas y el fallback.                                                        |
| **5. Posible piloto en el local al terminar la Fase 4**                                                        | Agenda, cobros (con Point cargado a mano), caja, stock y comisiones ya permiten operar. Usarlo en serio antes de integrar MP da feedback real temprano (pregunta P49).                                           |

**Schema:** la migración inicial de la Fase 1 crea el **schema completo aprobado** (es exactamente lo que se validó). Los ajustes que surjan después van en migraciones nuevas y revisables.

## Cómo trabajamos cada fase

1. Rama propia y commits chicos.
2. Tests en verde en CI.
3. Deploy a **staging**.
4. Resumen de la fase: qué se hizo, cómo probarlo, qué quedó pendiente, decisiones tomadas.
5. Tu revisión (con el arquitecto) y **aprobación explícita** → recién ahí la fase siguiente.

---

## Fase 1 — Base, acceso y esqueleto publicado

**Incluye**

- **Monorepo:** pnpm workspaces, TypeScript 6, lint y formato, Vitest, CI en GitHub Actions, docker-compose para desarrollo local.
- **Base de datos:** `packages/db` con Prisma 7.10, migración inicial (schema + `extra.sql`) y seed (1 organización, 1 sucursal, 1 admin, 2 barberos, servicios, productos, clientes).
- **Acceso del staff:** login con argon2id, rate limit y bloqueo. Invitación por email, recuperación de contraseña, cierre de sesión. Segundo factor listo (apagado).
- **Acceso de clientes:** código de 6 dígitos por email con todas las reglas (10 min, 5 intentos, HMAC, límites por email e IP). Completar perfil y consentimientos.
- **Autorización:** contexto por pedido, matriz de permisos compartida, políticas de "falla cerrada", sucursal validada en cada ruta.
- **Pantallas base:** layout de admin y de barbero (sidebar colapsable, drawer en el celular, selector de sucursal), portal del cliente (mobile first) y estructura de la página pública.
- **Worker:** conexión a BullMQ, jobs programados con IDs fijos, latido, monitor y **alertas visibles en el dashboard**.
- **Auditoría y bandeja de salida** de notificaciones (email).
- **Staging en Railway** detrás de Cloudflare: los 5 servicios, dominios, dominio de Resend verificado, verificación de `btree_gist`.

**Tests:**

- Códigos: vencimiento, intentos, invalidación y rate limits.
- Bloqueo del staff.
- **Matriz de permisos: todas las rutas × todos los roles.**
- Sesión revocada, que deja de funcionar al instante.

**Listo cuando:**

- En staging, el dueño entra con contraseña e invita a un barbero, que define la suya.
- Un cliente entra con el código que recibe por email.
- Cada uno ve su propio panel.
- Un barbero **no puede** usar rutas de admin (probado por test).
- Si se apaga el worker, aparece la alerta.

**Necesito:** P1 (dominio), P2 (cuentas), P3 (nombre y datos).

## Fase 2 — Catálogo, equipo y clientes

**Incluye**

- **Servicios:**
  - Categorías, duración, precio base y **precio por sucursal**.
  - Activo o no, reservable online o no.
  - Override de puntos, configuración de seña y override de comisión (se usan en las fases siguientes).
  - **Aumento masivo de precios por %**, auditado.
- **Productos:** catálogo. El stock llega en la Fase 4.
- **Barberos:**
  - Perfil, sucursales y servicios que realiza (con duración propia opcional).
  - **Horario semanal por sucursal**, con turno partido y vigencias.
  - Bloqueos (vacaciones, trámites) y cierres de sucursal (feriados).
  - Configuración de comisiones.
- **Clientes:**
  - **Alta rápida en una sola pantalla** (nombre, teléfono +54 9…, email, DNI opcional, consentimientos con fecha).
  - Búsqueda por nombre, teléfono, email o DNI, con aviso de posibles duplicados.
  - Ficha básica con datos, notas del barbero y consentimientos.
  - Importador CSV, si hace falta (P4).

**Tests:** normalización de teléfono y DNI, unicidades, qué clientes ve un barbero, aumento masivo de precios.

**Listo cuando:**

- Están cargados los servicios, precios y horarios **reales** de la sucursal.
- Un barbero da de alta un cliente desde el celular en menos de 30 segundos.

## Fase 3 — Agenda y reservas

**Incluye**

- **Motor de disponibilidad:** función pura con tests. Reserva con lock por barbero + restricción de la base.
- **Agenda:**
  - Vista de día y de semana, **una columna por barbero**.
  - Crear, mover y cancelar turnos. Estados y ausentes.
  - Atención sin turno.
  - Cada barbero ve su agenda.
- **Página pública por sucursal:**
  - Recorrido: servicio → barbero o "cualquiera" → día → horario → email y código → datos (si es nuevo) → confirmación.
  - Se ven los horarios sin loguearse.
- **Portal del cliente:** reservar y "mis turnos" (cancelar o reprogramar según las reglas).
- **Ficha:** historial de turnos, contador de ausencias y fusión de clientes duplicados.
- **Base de notificaciones** (canales, router, bandeja de salida) con **email**: confirmación y cancelación.

**Tests:**

- Disponibilidad: bordes de horario, zona horaria, bloqueos, cierres, anticipación.
- **Doble reserva con pedidos simultáneos.**
- Reglas de reserva online.
- El barbero ve solo su agenda.

**Listo cuando:**

- Un test automático prueba que, de dos personas que buscan el mismo horario, solo una lo consigue.
- Un cliente reserva desde el celular en menos de 1 minuto y recibe la confirmación por email.
- La agenda del día es cómoda de usar en el local.

## Fase 4 — Caja, ventas, stock, egresos y comisiones ← posible piloto

**Incluye**

- **Cobros:**
  - **Cerrar servicio** (venta desde el turno, con precio reservado, productos y propinas) y venta de mostrador.
  - Medios de pago: efectivo, transferencia, Point cargado a mano y otro.
  - Pagos divididos. Descuentos (admin). Anulación con reversas.
  - `Idempotency-Key` en todo lo que mueve plata.
- **Stock por sucursal:** descuento automático al pagar, compras, ajustes con motivo, alertas de mínimo, historial.
- **Caja diaria:** apertura, aportes y retiros, egresos con categoría, **cierre con arqueo por medio de pago** y diferencia registrada.
- **Egresos fuera de caja** (alquiler, etc.) y **resultado del mes** básico.
- **Comisiones:** cálculo al pagarse la venta, reversas, liquidaciones por período, marcar pagada (genera el egreso), vista "Mis comisiones".
- **Ficha:** historial de servicios y pagos.

**Tests:**

- **Cálculo de comisiones:** overrides, descuentos, propinas, canjes, reversas.
- "Todo o nada" al pagar una venta.
- Stock con ventas simultáneas.
- Esperado de caja.
- Doble clic en "Cobrar".

**Listo cuando:**

- Se puede operar un día completo con el sistema: abrir caja, turnos, cobros, egresos y cierre con arqueo.
- El barbero ve sus comisiones y solo las suyas.

## Fase 5 — Mercado Pago

**Incluye**

- **Vinculación:** token y clave de webhooks cifrados. Asistente con los pasos del panel de MP.
- **Terminales:** listar, asignar a sucursal, pasar a modo PDV.
- **Cobro con Point** (API de Orders):
  - Estado en vivo en la pantalla de cobro.
  - Cancelación cuando MP la permite.
  - Terminal ocupada.
- **Webhooks:** firma, idempotencia, cola y consulta del estado real.
- **Redes de seguridad:** sondeo de órdenes pendientes y sync de pagos.
- **Bandeja "Pagos sin asignar"** con sugerencias (asignar a venta, seña, saldo a favor, otro ingreso o ignorar).
- **Señas con Checkout Pro:** retención del horario, vencimiento, política de cancelación (reintegro o saldo), pago tardío.
- **Uso del saldo a favor** al cobrar. Reintegros.
- **Runbooks:** vincular cuenta, pasar una terminal a PDV, **contingencia sin sistema**, pasaje a producción.

**Tests:**

- **Validación de firma:** válida, alterada, sin header, id alfanumérico.
- **Idempotencia:** el mismo webhook 3 veces → 1 cobro, 1 venta, 1 acreditación.
- Mapeo de estados.
- Retención y pago tardío.
- Reglas de conciliación.

**Listo cuando:**

- En sandbox, con la terminal virtual de MP, funcionan cobro, rechazo, cancelación, expiración y reintegro.
- Una seña online confirma un turno y una seña impaga lo libera.
- Después se valida con **un Point real y la cuenta real** (R2, R5).

**Necesito:** P5, P7, credenciales de prueba y de producción de MP, y el MCP oficial de Mercado Pago conectado a Claude Code.

## Fase 6 — Notificaciones completas

**Incluye**

- **WhatsApp Cloud API:**
  - Plantillas por tipo de mensaje (configurables).
  - Webhooks de estado y de bajas.
  - ID de usuario (BSUID).
  - Respuestas "BAJA".
- **Fallback automático** a email.
- **Webhooks de Resend:** entregado, rebote, spam.
- **Mensajes:** recordatorios (24 h y 2 h), reprogramación, **reactivación**, **pedido de reseña** (link por sucursal).
- **Reglas:** franja sin marketing, consentimientos y bajas.
- **Pantalla de notificaciones:** registro de envíos con estados y configuración por tipo.

**Tests:** fallback (WhatsApp falla → email), consentimiento y franja horaria, sin duplicados, reprogramar un turno regenera los recordatorios.

**Listo cuando:**

- Un turno genera confirmación y recordatorios por el canal correcto.
- Con WhatsApp apagado, todo sale por email sin errores.

**Necesito:** P6, el número de WhatsApp, la verificación en Meta y las plantillas aprobadas.

## Fase 7 — Puntos y recompensas

**Incluye**

- **Reglas:** X puntos cada $Y y override por servicio.
- **Acreditación** solo al pagarse la venta; reversa al anularla.
- **Vencimiento** con un job diario.
- **Catálogo de recompensas** y **canje en el cobro**.
- **Ajustes manuales** (solo admin, con motivo).
- **Avisos:** puntos acreditados y recompensa disponible.
- **Portal:** "Mis puntos".

**Tests:**

- **Ledger:** saldo = suma, sin ediciones.
- Idempotencia.
- Vencimiento FIFO (correrlo dos veces no vence de más).
- Canje simultáneo.
- Anulación con puntos ya gastados.

**Listo cuando:** un cliente suma puntos al pagar, los ve en su portal y canjea un corte gratis en el local, y todo queda en el ledger.

## Fase 8 — Dashboard, reportes y salida a producción

**Incluye**

- **Dashboard:**
  - Ingresos del día, la semana y el mes por medio de pago.
  - Turnos del día, ocupación por barbero, ticket promedio, ausentes.
  - Nuevos vs recurrentes.
  - Stock bajo, pagos sin asignar y alertas del sistema.
- **Reportes** con filtro de sucursal y fechas: ventas, servicios más vendidos, rendimiento por barbero, comisiones, resultado (ingresos − egresos), puntos emitidos y canjeados.
- **Exportación CSV** (auditada).
- **Salida a producción:**
  - Entorno de producción.
  - Backups externos con **prueba de restauración**.
  - Segundo factor para admins.
  - Rol de base con mínimo privilegio.
  - Monitor externo.
  - Tests end-to-end (Playwright).
  - Checklist de Cloudflare.
  - Revisión de seguridad.

**Listo cuando:**

- Los números del dashboard coinciden con el cierre de caja de un día real.
- El checklist de salida a producción está completo y aprobado.
