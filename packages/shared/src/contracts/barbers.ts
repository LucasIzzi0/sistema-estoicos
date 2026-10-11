import { z } from 'zod';
import { bpsSchema, dateSchema, optionalText, timeSchema } from './common';

/**
 * Barberos: perfiles SIN acceso al sistema (decisión del 25/09/2026). Los gestiona el admin:
 * sucursales donde trabajan, servicios que hacen, horario semanal, bloqueos y comisiones.
 */
export const SETTLEMENT_PERIODS = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'CUSTOM'] as const;
export const TIME_OFF_TYPES = ['VACATION', 'BREAK', 'SICK_LEAVE', 'PERSONAL', 'TRAINING', 'OTHER'] as const;

export const TIME_OFF_LABELS: Record<(typeof TIME_OFF_TYPES)[number], string> = {
  VACATION: 'Vacaciones',
  BREAK: 'Descanso',
  SICK_LEAVE: 'Enfermedad',
  PERSONAL: 'Trámite personal',
  TRAINING: 'Capacitación',
  OTHER: 'Otro',
};

const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, { error: 'Color inválido' })
  .nullable();

export const barberSummarySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  color: z.string().nullable(),
  active: z.boolean(),
  acceptsOnlineBooking: z.boolean(),
  branchIds: z.array(z.string()),
  serviceCount: z.number(),
  /** Tiene horario cargado en alguna sucursal. */
  hasSchedule: z.boolean(),
});
export type BarberSummary = z.infer<typeof barberSummarySchema>;

export const scheduleIntervalSchema = z.object({
  weekday: z.number().int().min(1).max(7),
  startMinute: z.number().int().min(0).max(1440),
  endMinute: z.number().int().min(0).max(1440),
});

export const barberDetailSchema = barberSummarySchema.extend({
  bio: z.string().nullable(),
  serviceCommissionBps: z.number(),
  productCommissionBps: z.number(),
  tipCommissionBps: z.number(),
  settlementPeriod: z.enum(SETTLEMENT_PERIODS).nullable(),
  services: z.array(
    z.object({
      serviceId: z.string(),
      serviceName: z.string(),
      durationMin: z.number(),
      durationMinOverride: z.number().nullable(),
      commissionBpsOverride: z.number().nullable(),
    }),
  ),
  schedules: z.array(scheduleIntervalSchema.extend({ branchId: z.string() })),
  timeOffs: z.array(
    z.object({
      id: z.string(),
      branchId: z.string().nullable(),
      type: z.enum(TIME_OFF_TYPES),
      startsAt: z.string(),
      endsAt: z.string(),
      note: z.string().nullable(),
    }),
  ),
});
export type BarberDetail = z.infer<typeof barberDetailSchema>;

const barberFields = {
  displayName: z.string().trim().min(1, { error: 'Poné un nombre' }).max(40),
  color: colorSchema,
  bio: optionalText(300),
  branchIds: z.array(z.uuid()).min(1, { error: 'Elegí al menos una sucursal' }),
  acceptsOnlineBooking: z.boolean(),
  serviceCommissionBps: bpsSchema,
  productCommissionBps: bpsSchema,
  tipCommissionBps: bpsSchema,
  settlementPeriod: z.enum(SETTLEMENT_PERIODS).nullable(),
};

export const createBarberBody = z.object({
  ...barberFields,
  color: barberFields.color.default(null),
  acceptsOnlineBooking: barberFields.acceptsOnlineBooking.default(true),
  serviceCommissionBps: barberFields.serviceCommissionBps.default(0),
  productCommissionBps: barberFields.productCommissionBps.default(0),
  tipCommissionBps: barberFields.tipCommissionBps.default(0),
  settlementPeriod: barberFields.settlementPeriod.default(null),
});
export type CreateBarberBody = z.input<typeof createBarberBody>;

export const updateBarberBody = z.object({ ...barberFields, active: z.boolean() }).partial();
export type UpdateBarberBody = z.input<typeof updateBarberBody>;

export const barberIdParams = z.object({ barberId: z.uuid() });

export const setBarberServicesBody = z.object({
  services: z.array(
    z.object({
      serviceId: z.uuid(),
      durationMinOverride: z
        .number()
        .int()
        .min(5)
        .max(600)
        .refine((v) => v % 5 === 0, { error: 'La duración va de 5 en 5 minutos' })
        .nullable(),
      commissionBpsOverride: bpsSchema.nullable(),
    }),
  ),
});
export type SetBarberServicesBody = z.input<typeof setBarberServicesBody>;

export const setBarberScheduleBody = z.object({
  branchId: z.uuid(),
  intervals: z.array(scheduleIntervalSchema).max(50),
});
export type SetBarberScheduleBody = z.input<typeof setBarberScheduleBody>;

/**
 * Bloqueo: días completos (fecha desde/hasta) o un rango horario dentro de un día.
 * Las fechas y horas son de la sucursal; la API las convierte con su zona horaria.
 */
export const createTimeOffBody = z
  .object({
    branchId: z.uuid().nullable(),
    type: z.enum(TIME_OFF_TYPES),
    date: dateSchema,
    endDate: dateSchema.nullish(),
    startTime: timeSchema.nullish(),
    endTime: timeSchema.nullish(),
    note: optionalText(200),
  })
  .refine((v) => Boolean(v.startTime) === Boolean(v.endTime), {
    error: 'Indicá hora de inicio y de fin, o ninguna para todo el día',
    path: ['endTime'],
  });
export type CreateTimeOffBody = z.input<typeof createTimeOffBody>;

export const timeOffIdParams = z.object({ barberId: z.uuid(), timeOffId: z.uuid() });
