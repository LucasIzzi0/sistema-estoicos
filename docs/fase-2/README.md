# Fase 2 — Catálogo, barberos y clientes

**Fecha:** 25/09/2026
**Estado:** aprobada (25/09/2026).
Incorpora las respuestas de producto del mismo día ([decisiones](../decisiones/2026-09-25-respuestas-de-producto.md)).

## Qué quedó hecho

| Módulo | Detalle |
|---|---|
| **Roles** | Los barberos **no son usuarios** (decisión del fundador). Usuarios: dueño, encargado (limitado a sus sucursales) y **recepción** (preparado y oculto). Migración que quita el rol BARBER sin perder los perfiles. Sin panel del barbero. |
| **Servicios** | Categorías, duración, precio base, **precio propio por sucursal** (o no ofrecerlo), reserva online sí o no, **seña** fija o % (se cobra desde la Fase 5), puntos propios, comisión propia, archivar. **Aumento masivo por %** con redondeo y vista previa, que también ajusta los precios de cada sucursal. Cada cambio de precio queda auditado. |
| **Productos** | Catálogo con precio, costo (muestra margen), códigos, precio por sucursal, aumento masivo. El stock llega en la Fase 4. |
| **Barberos** | Perfil (nombre, color de agenda), sucursales, comisiones (servicios, productos, propinas) con período de liquidación. **Servicios que hace** con duración y comisión propias. **Horario semanal por sucursal** con turno partido: rechaza tramos que se pisen, **también contra su horario en otra sucursal**. **Bloqueos** por días completos o por horas, en hora local. |
| **Clientes** | **Alta rápida en una pantalla** con email obligatorio, celular normalizado, DNI opcional y consentimientos con fecha y usuario. **Duplicados:** mismo email o DNI bloquea y muestra de quién es; mismo celular pregunta "¿es otra persona?". **Búsqueda al instante** sin acentos por nombre, email, celular (por sus últimos 8 dígitos) o DNI, con índice de trigramas. **Ficha:** datos editables, contadores (turnos, ausencias), consentimientos con historial, **notas** fijables. |
| **Configuración** | Sucursales (alta y edición solo del dueño, con link de reservas y link de reseñas de Google), **feriados por sucursal**, usuarios del sistema. |

## Verificación

- **101 tests en verde** (antes 65). Los 71 de la API incluyen:
  - La **matriz de permisos**, que ahora recorre también todas las rutas nuevas con dueño, encargado, recepción y cliente.
  - Aumento masivo con redondeo.
  - Precio por sucursal: el encargado lo cambia en la suya y en otra recibe 403.
  - Horarios que se pisan, incluso entre sucursales.
  - Bloqueos y feriados en hora de Buenos Aires.
  - Duplicados, búsqueda sin acentos, consentimientos y notas.
- **Recorrido completo en el navegador** con los 3 servicios levantados:
  - Crear un servicio y aplicar un aumento masivo.
  - Dar de alta un barbero, cargarle turno partido y un bloqueo.
  - Registrar un cliente, agregarle una nota y resolver un celular repetido.
  - Buscar sin acentos y cargar un feriado.
  - Capturas en escritorio y celular.
- Lint, tipos (8 paquetes) y `next build` OK.

## Decisiones tomadas en la fase

| Decisión | Motivo |
|---|---|
| La columna de búsqueda del cliente la normaliza la app, y se indexa con `pg_trgm` | Buscar "martin" encuentra "Martín" y "Martínez" sin depender de la extensión `unaccent` |
| Un barbero nuevo arranca haciendo todos los servicios activos | Es lo habitual; se destilda lo que no hace |
| Si un barbero deja una sucursal, se borra su horario ahí | Un horario huérfano generaría disponibilidad falsa |
| Las notas de clientes se ocultan, no se borran | Queda el historial |
| El seed (solo de desarrollo) usa utilidades de `shared` | Así no se duplica la normalización de búsqueda |

## Pendiente

- La lista real de servicios (con duración y precio) y el horario del local: te los pido en otra sesión.
- Staging en Railway: cuando esté el dominio.
