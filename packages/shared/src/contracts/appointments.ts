import { z } from 'zod';
import { dateSchema, optionalText, timeSchema } from './common';

/**
 * Agenda y reservas (Fase 3). Las fechas y horas que viajan en los pedidos son LOCALES de la
 * sucursal ("2026-10-12" + "10:30"); la API las convierte a instantes con la zona de la sucursal.
 */
export const APPOINTMENT_STATUSES = [
  'PENDING_PAYMENT',
  'BOOKED',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELED',
  'NO_SHOW',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Estados que ocupan el horario del barbero (los mismos que la restricción de la base). */
export const ACTIVE_APPOINTMENT_STATUSES = ['PENDING_PAYMENT', 'BOOKED', 'CONFIRMED', 'IN_PROGRESS'] as const;

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  PENDING_PAYMENT: 'Esperando seña',
  BOOKED: 'Reservado',
  CONFIRMED: 'Confirmado',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Atendido',
  CANCELED: 'Cancelado',
  NO_SHOW: 'No vino',
};

export const APPOINTMENT_SOURCES = ['ONLINE', 'STAFF', 'WALK_IN'] as const;
export const APPOINTMENT_SOURCE_LABELS: Record<(typeof APPOINTMENT_SOURCES)[number], string> = {
  ONLINE: 'Reserva online',
  STAFF: 'Agendado en el local',
  WALK_IN: 'Sin turno',
};

export const CANCEL_REASONS = [
  'CUSTOMER_REQUEST',
  'STAFF_DECISION',
  'PAYMENT_TIMEOUT',
  'BARBER_UNAVAILABLE',
  'DUPLICATE',
  'OTHER',
] as const;
export const CANCEL_REASON_LABELS: Record<(typeof CANCEL_REASONS)[number], string> = {
  CUSTOMER_REQUEST: 'Lo pidió el cliente',
  STAFF_DECISION: 'Decisión del local',
  PAYMENT_TIMEOUT: 'No pagó la seña a tiempo',
  BARBER_UNAVAILABLE: 'El barbero no puede',
  DUPLICATE: 'Turno repetido',
  OTHER: 'Otro motivo',
};
/** Motivos que puede elegir el staff al cancelar. */
export const STAFF_CANCEL_REASONS = [
  'CUSTOMER_REQUEST',
  'STAFF_DECISION',
  'BARBER_UNAVAILABLE',
  'DUPLICATE',
  'OTHER',
] as const;

export const APPOINTMENT_EVENT_LABELS = {
  CREATED: 'Turno creado',
  STATUS_CHANGED: 'Cambio de estado',
  RESCHEDULED: 'Turno movido',
  REASSIGNED: 'Cambio de barbero',
  UPDATED: 'Turno editado',
} as const;

/** Servicios de un turno: todos con el mismo barbero (decisión P13). */
export const serviceIdsSchema = z
  .array(z.uuid())
  .min(1, { error: 'Elegí al menos un servicio' })
  .max(5, { error: 'Máximo 5 servicios por turno' })
  .refine((ids) => new Set(ids).size === ids.length, { error: 'Hay servicios repetidos' });

/** En la query string los servicios viajan como "id1,id2" (ya separados, se acepta igual). */
const serviceIdsQuery = z
  .union([z.string().transform((s) => s.split(',').filter(Boolean)), z.array(z.string())])
  .pipe(serviceIdsSchema);

// ---------------------------------------------------------------------------
// Disponibilidad
// ---------------------------------------------------------------------------

export const availabilityQuery = z.object({
  serviceIds: serviceIdsQuery,
  /** Sin barbero = "cualquier barbero". */
  barberId: z.uuid().optional(),
  from: dateSchema,
  days: z.coerce.number().int().min(1).max(14).default(7),
  /** Al mover un turno desde el panel, su propio horario no cuenta como ocupado. */
  excludeAppointmentId: z.uuid().optional(),
});
export type AvailabilityQuery = z.input<typeof availabilityQuery>;

/** Horarios para reprogramar un turno propio: mismos servicios; barbero igual, otro o "any". */
export const rescheduleAvailabilityQuery = z.object({
  from: dateSchema,
  days: z.coerce.number().int().min(1).max(14).default(7),
  barberId: z.union([z.uuid(), z.literal('any')]).optional(),
});
export type RescheduleAvailabilityQuery = z.input<typeof rescheduleAvailabilityQuery>;

export const slotSchema = z.object({
  /** Hora local "10:30". */
  time: z.string(),
  startsAt: z.string(),
  /** Barberos libres en ese horario. */
  barberIds: z.array(z.string()),
});
export type Slot = z.infer<typeof slotSchema>;

export const availabilitySchema = z.object({
  timezone: z.string(),
  days: z.array(z.object({ date: z.string(), slots: z.array(slotSchema) })),
  /** Último día reservable online (null en el panel: el staff no tiene ese límite). */
  lastDate: z.string().nullable(),
});
export type Availability = z.infer<typeof availabilitySchema>;

// ---------------------------------------------------------------------------
// Agenda del panel
// ---------------------------------------------------------------------------

export const agendaQuery = z.object({
  date: dateSchema,
  days: z.coerce.number().int().min(1).max(7).default(1),
  barberId: z.uuid().optional(),
});

const appointmentServiceSchema = z.object({
  serviceId: z.string(),
  name: z.string(),
  durationMin: z.number(),
  priceCents: z.number(),
});

export const agendaAppointmentSchema = z.object({
  id: z.string(),
  barberId: z.string(),
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  /** Ausencias anteriores del cliente (para avisar en recepción). */
  customerNoShows: z.number(),
  status: z.enum(APPOINTMENT_STATUSES),
  source: z.enum(APPOINTMENT_SOURCES),
  startsAt: z.string(),
  endsAt: z.string(),
  services: z.array(appointmentServiceSchema),
  bookedTotalCents: z.number(),
  anyBarberRequested: z.boolean(),
  customerNotes: z.string().nullable(),
  internalNotes: z.string().nullable(),
});
export type AgendaAppointment = z.infer<typeof agendaAppointmentSchema>;

export const agendaSchema = z.object({
  branchId: z.string(),
  timezone: z.string(),
  from: z.string(),
  days: z.number(),
  barbers: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      color: z.string().nullable(),
      /** Tramos de trabajo por día (minutos locales). */
      workingHours: z.array(z.object({ date: z.string(), startMinute: z.number(), endMinute: z.number() })),
    }),
  ),
  timeOffs: z.array(
    z.object({
      id: z.string(),
      barberId: z.string(),
      startsAt: z.string(),
      endsAt: z.string(),
      type: z.string(),
      note: z.string().nullable(),
    }),
  ),
  closures: z.array(
    z.object({ id: z.string(), startsAt: z.string(), endsAt: z.string(), reason: z.string() }),
  ),
  appointments: z.array(agendaAppointmentSchema),
});
export type Agenda = z.infer<typeof agendaSchema>;

export const appointmentIdParams = z.object({ appointmentId: z.uuid() });

export const appointmentDetailSchema = agendaAppointmentSchema.extend({
  branchId: z.string(),
  barberName: z.string(),
  customerEmail: z.string().nullable(),
  createdAt: z.string(),
  cancelReason: z.enum(CANCEL_REASONS).nullable(),
  cancelNote: z.string().nullable(),
  events: z.array(
    z.object({
      id: z.string(),
      type: z.enum(['CREATED', 'STATUS_CHANGED', 'RESCHEDULED', 'REASSIGNED', 'UPDATED']),
      fromStatus: z.enum(APPOINTMENT_STATUSES).nullable(),
      toStatus: z.enum(APPOINTMENT_STATUSES).nullable(),
      previousStartsAt: z.string().nullable(),
      actor: z.string(),
      note: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type AppointmentDetail = z.infer<typeof appointmentDetailSchema>;

/**
 * Turno cargado por el staff. Si queda fuera del horario del barbero, la API responde 409
 * OUTSIDE_SCHEDULE y `force: true` lo agenda igual. Nunca se puede pisar otro turno.
 */
export const createAppointmentBody = z.object({
  barberId: z.uuid(),
  customerId: z.uuid(),
  serviceIds: serviceIdsSchema,
  date: dateSchema,
  time: timeSchema,
  internalNotes: optionalText(500),
  force: z.boolean().default(false),
});
export type CreateAppointmentBody = z.input<typeof createAppointmentBody>;

/** Atención sin turno: empieza ahora. El cliente es opcional (P18). */
export const walkInBody = z.object({
  barberId: z.uuid(),
  customerId: z.uuid().nullish(),
  serviceIds: serviceIdsSchema,
  internalNotes: optionalText(500),
});
export type WalkInBody = z.input<typeof walkInBody>;

/** Mover (día, hora, barbero) o cambiar servicios. Todo lo que cambia el horario pasa por el lock. */
export const updateAppointmentBody = z.object({
  barberId: z.uuid().optional(),
  date: dateSchema.optional(),
  time: timeSchema.optional(),
  serviceIds: serviceIdsSchema.optional(),
  internalNotes: z.string().trim().max(500).nullable().optional(),
  force: z.boolean().default(false),
});
export type UpdateAppointmentBody = z.input<typeof updateAppointmentBody>;

export const STAFF_STATUS_TARGETS = ['BOOKED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'] as const;
export const appointmentStatusBody = z.object({
  status: z.enum(STAFF_STATUS_TARGETS),
  note: optionalText(300),
});
export type AppointmentStatusBody = z.input<typeof appointmentStatusBody>;

export const cancelAppointmentBody = z.object({
  reason: z.enum(STAFF_CANCEL_REASONS),
  note: optionalText(300),
  notifyCustomer: z.boolean().default(true),
});
export type CancelAppointmentBody = z.input<typeof cancelAppointmentBody>;

// ---------------------------------------------------------------------------
// Reserva pública y portal del cliente
// ---------------------------------------------------------------------------

export const branchSlugParams = z.object({ slug: z.string().trim().min(1).max(80) });

export const publicBranchSummarySchema = z.object({
  name: z.string(),
  slug: z.string(),
  address: z.string().nullable(),
  city: z.string().nullable(),
});
export type PublicBranchSummary = z.infer<typeof publicBranchSummarySchema>;

export const publicBranchSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  timezone: z.string(),
  bookingEnabled: z.boolean(),
  rules: z.object({
    allowAnyBarber: z.boolean(),
    maxDaysAhead: z.number(),
    minNoticeMinutes: z.number(),
    maxActivePerCustomer: z.number(),
    rescheduleMinNoticeHours: z.number(),
  }),
  services: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      categoryName: z.string().nullable(),
      durationMin: z.number(),
      priceCents: z.number(),
    }),
  ),
  barbers: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      color: z.string().nullable(),
      photoUrl: z.string().nullable(),
      bio: z.string().nullable(),
      serviceIds: z.array(z.string()),
    }),
  ),
});
export type PublicBranch = z.infer<typeof publicBranchSchema>;

export const customerBookingBody = z.object({
  branchId: z.uuid(),
  serviceIds: serviceIdsSchema,
  /** null = cualquier barbero. */
  barberId: z.uuid().nullable(),
  date: dateSchema,
  time: timeSchema,
  notes: optionalText(300),
});
export type CustomerBookingBody = z.input<typeof customerBookingBody>;

export const customerRescheduleBody = z.object({
  date: dateSchema,
  time: timeSchema,
  /** Sin indicar = el mismo barbero; null = cualquiera. */
  barberId: z.uuid().nullable().optional(),
});
export type CustomerRescheduleBody = z.input<typeof customerRescheduleBody>;

export const myAppointmentSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  branchName: z.string(),
  branchSlug: z.string(),
  branchAddress: z.string().nullable(),
  barberId: z.string(),
  barberName: z.string(),
  status: z.enum(APPOINTMENT_STATUSES),
  startsAt: z.string(),
  endsAt: z.string(),
  timezone: z.string(),
  services: z.array(appointmentServiceSchema),
  totalCents: z.number(),
  /** Hasta cuándo se puede cambiar el horario desde la web (P15: 3 h antes). */
  changeDeadline: z.string(),
  canChange: z.boolean(),
  /** Cancelar online se puede hasta la hora del turno (decisión del 25/09/2026). */
  canCancel: z.boolean(),
});
export type MyAppointment = z.infer<typeof myAppointmentSchema>;

export const myAppointmentsSchema = z.object({
  upcoming: z.array(myAppointmentSchema),
  past: z.array(myAppointmentSchema),
});
export type MyAppointments = z.infer<typeof myAppointmentsSchema>;

// ---------------------------------------------------------------------------
// Fusión de clientes duplicados
// ---------------------------------------------------------------------------

export const mergeCustomerBody = z.object({
  /** El registro repetido: sus turnos, notas y datos pasan al cliente de la URL. */
  duplicateId: z.uuid(),
});
export type MergeCustomerBody = z.input<typeof mergeCustomerBody>;
