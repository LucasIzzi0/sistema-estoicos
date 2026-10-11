# Fase 6 — Notificaciones completas (WhatsApp)

**Fecha:** 28/09/2026
**Estado:** aprobada (28/09/2026), **a falta del número de WhatsApp aprobado en Meta**.
Aplica tus respuestas del mismo día ([decisiones](../decisiones/2026-09-25-respuestas-de-producto.md)): recordatorios a las 24 h y 2 h, con botones para confirmar o cancelar, y los dos mensajes de marketing activados.

> **Falta el número de WhatsApp.** Todo se construyó y probó contra un **WhatsApp simulado**. Hasta que Meta apruebe el número y las plantillas, **todo sale por email y el sistema funciona igual**.

## Qué quedó hecho

| Módulo | Detalle |
|---|---|
| **Router de canales** | Decide por dónde sale cada mensaje: preferencia del cliente → consentimiento del canal → disponibilidad (WhatsApp prendido, plantilla aprobada, número con WhatsApp, email sin rebotes). Si no hay canal, **no se manda y queda registrado el motivo**, visible en el historial. |
| **Fallback automático** | Si WhatsApp falla, el mismo mensaje se rehace por email al instante, apuntando al fallido. Si el número no tiene WhatsApp, queda marcado y los próximos mensajes van directo por email. |
| **Recordatorios** | **24 h y 2 h antes**, con **botones para confirmar o cancelar** en un toque, sin iniciar sesión (el link lleva un token firmado que solo sirve para ese turno y esa acción). Si el turno se mueve, se manda un recordatorio nuevo. Un turno cancelado no recibe nada. |
| **Pedido de reseña** | 2 h después de cobrar (configurable), con el link de Google de esa sucursal. Máximo uno cada 90 días por cliente. |
| **Reactivación** | A las 5 semanas sin venir (configurable). No se repite antes de 30 días y **no molesta a quien ya tiene turno**. |
| **Franja sin promociones** | 21 a 9 h por defecto, configurable. Solo frena las promociones: los avisos de turnos salen a cualquier hora. |
| **Bajas** | El cliente se da de baja desde el link del email (con un toque de confirmación, así los previsualizadores de correo no lo dan de baja solo) o respondiendo **"BAJA"** por WhatsApp. Queda la evidencia con fecha, canal y origen. Los avisos de turnos le siguen llegando. |
| **Estados de cada envío** | Llegan por webhooks firmados: WhatsApp (enviado, entregado, leído, fallido) y Resend (entregado, rebote, spam). Un rebote permanente marca el email y no se le vuelve a escribir ahí; una denuncia de spam corta también las promociones. |
| **Pantalla de Notificaciones** | Prender WhatsApp, cargar el nombre de cada plantilla (con **las variables en orden**, listas para copiar al crearlas en Meta), ajustar los horarios y ver el **registro de envíos** con su estado y su motivo. |
| **Sin credenciales** | En desarrollo hay un **WhatsApp simulado** (`WHATSAPP_SIMULATED`) que reproduce los errores reales de Meta. Nunca existe en producción. |

## Verificación

- **242 tests en verde** (antes 208):
  - 13 del **router** (función pura): preferencia, consentimiento por canal y alcance, plantilla faltante, número sin WhatsApp, email rebotado, franja horaria que cruza la medianoche, y el código de login que siempre va por email.
  - 21 de integración, entre ellos:
    - Con plantilla cargada, el recordatorio sale por **WhatsApp** con sus botones; el número viaja como lo espera Meta.
    - **WhatsApp falla → el mismo mensaje sale por email** y el número queda marcado.
    - Sin consentimiento no se manda nada, y el motivo queda en el historial.
    - Los recordatorios salen a las 24 h y a las 2 h, **no se repiten**, y **mover el turno los regenera**.
    - El cliente confirma y cancela desde el link, sin iniciar sesión; un token inventado da 403.
    - El marketing no sale de madrugada; la reactivación no molesta a quien ya tiene turno; la baja corta las promociones y deja la evidencia.
    - Webhooks: firma inválida → 401 y aviso en el panel; entregado y leído se registran; un rebote marca al cliente.
- **Recorrido en el navegador** (10 pasos, todos OK): configurar WhatsApp y una plantilla → un cliente reserva desde el celular → se dispara el recordatorio → sale por WhatsApp → el cliente confirma desde el link → se da de baja de las promociones → el registro muestra todo.
- **Los datos cierran**: código de login por email (siempre), confirmación por email (ese tipo no tiene plantilla), recordatorio por WhatsApp, turno confirmado desde el link, y la baja registrada en los dos canales.
- Lint, tipos (8 paquetes) y `next build` OK.

## Decisiones y hallazgos de la fase

| Decisión | Motivo |
|---|---|
| La baja **pide un toque de confirmación** | Algunos correos abren los links solos para previsualizarlos; si la baja se aplicara al abrir, daría de baja a quien no quiso. |
| Los mensajes de acceso (código de login) **van siempre por email y no se pueden apagar** | Es la llave para entrar: apagarlos dejaría a los clientes afuera. |
| La bandeja de salida usa el **reloj de la app**, no el del sistema | **Bug encontrado por los tests:** la franja sin promociones se evaluaba con la hora real, así que en los tests (y ante cualquier desfase) podía mandar a la hora equivocada. |
| La firma de Meta se valida sobre el **cuerpo crudo** | Reserializar el JSON cambia espacios y orden de claves, y la firma dejaría de coincidir. Se guarda el cuerpo tal como llegó. |
| La clave anti-duplicado del recordatorio incluye el horario del turno | Si el turno se mueve, corresponde un recordatorio nuevo; si no, el cliente se quedaría con la hora vieja. |
| Cada tipo muestra **sus variables numeradas** en pantalla | Las plantillas de Meta usan variables posicionales: si el orden no coincide, el mensaje sale con los datos cambiados de lugar. |

## Pendiente

- **Número de WhatsApp**: darlo de alta en Meta, verificar la empresa y **hacer aprobar las plantillas** (tarda unos días). Después cargás el nombre de cada plantilla en la pantalla de Notificaciones y lo prendés.
- La lista real de servicios y el horario del local.
- Puntos y recompensas: Fase 7. Reportes completos y export: Fase 8.
