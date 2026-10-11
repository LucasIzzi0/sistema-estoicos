import { z } from 'zod';
import { emailSchema, mobilePhoneSchema, personNameSchema } from './common';
import { APPOINTMENT_STATUSES } from './appointments';
import { notificationChannelSchema } from './auth';

/** DNI: solo dígitos (se aceptan puntos al escribirlo). Opcional y único por marca. */
export const dniSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\./g, ''))
  .pipe(z.string().regex(/^\d{6,9}$/, { error: 'El DNI son 7 u 8 números' }))
  .nullish()
  .transform((v) => v ?? null);

/**
 * Alta rápida en el local (una sola pantalla). Email obligatorio (decisión del 25/09/2026).
 * Si ya hay alguien con el mismo celular, la API avisa; `allowSamePhone` confirma que es otra
 * persona (padres e hijos pueden compartir celular).
 */
export const createCustomerBody = z.object({
  firstName: personNameSchema,
  lastName: personNameSchema,
  phone: mobilePhoneSchema,
  email: emailSchema,
  dni: dniSchema,
  preferredChannel: notificationChannelSchema.default('WHATSAPP'),
  acceptTransactional: z.boolean(),
  acceptMarketing: z.boolean(),
  homeBranchId: z.uuid().nullish(),
  allowSamePhone: z.boolean().default(false),
});
export type CreateCustomerBody = z.input<typeof createCustomerBody>;

export const updateCustomerBody = z
  .object({
    firstName: personNameSchema,
    lastName: personNameSchema,
    phone: mobilePhoneSchema,
    email: emailSchema,
    dni: dniSchema,
    preferredChannel: notificationChannelSchema,
    acceptTransactional: z.boolean(),
    acceptMarketing: z.boolean(),
    homeBranchId: z.uuid().nullable(),
  })
  .partial();
export type UpdateCustomerBody = z.input<typeof updateCustomerBody>;

export const customerIdParams = z.object({ customerId: z.uuid() });

export const customerSearchQuery = z.object({
  q: z.string().trim().max(80).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const customerListItemSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  dni: z.string().nullable(),
  lastVisitAt: z.string().nullable(),
  createdAt: z.string(),
});
export type CustomerListItem = z.infer<typeof customerListItemSchema>;

export const customerDetailSchema = customerListItemSchema.extend({
  preferredChannel: notificationChannelSchema,
  emailVerifiedAt: z.string().nullable(),
  source: z.enum(['IN_STORE', 'ONLINE_BOOKING', 'IMPORT']),
  homeBranchId: z.string().nullable(),
  consents: z.object({ transactional: z.boolean(), marketing: z.boolean() }),
  consentHistory: z.array(
    z.object({
      channel: z.enum(['EMAIL', 'WHATSAPP']),
      scope: z.enum(['TRANSACTIONAL', 'MARKETING']),
      granted: z.boolean(),
      source: z.string(),
      occurredAt: z.string(),
    }),
  ),
  notes: z.array(
    z.object({
      id: z.string(),
      body: z.string(),
      pinned: z.boolean(),
      authorName: z.string(),
      createdAt: z.string(),
    }),
  ),
  stats: z.object({ appointments: z.number(), noShows: z.number() }),
  /** Últimos turnos (más recientes primero). */
  appointments: z.array(
    z.object({
      id: z.string(),
      startsAt: z.string(),
      status: z.enum(APPOINTMENT_STATUSES),
      branchName: z.string(),
      barberName: z.string(),
      services: z.array(z.string()),
      totalCents: z.number(),
    }),
  ),
  /** Últimas ventas (cobradas o anuladas) con sus medios de pago. */
  sales: z.array(
    z.object({
      id: z.string(),
      number: z.number(),
      status: z.enum(['OPEN', 'PAID', 'VOIDED']),
      date: z.string(),
      summary: z.string(),
      totalCents: z.number(),
      methods: z.array(z.string()),
    }),
  ),
});
export type CustomerDetail = z.infer<typeof customerDetailSchema>;

/** Posible duplicado: la API responde 409 con esta lista en `details.matches`. */
export const duplicateMatchSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  reason: z.enum(['EMAIL', 'DNI', 'PHONE']),
});
export type DuplicateMatch = z.infer<typeof duplicateMatchSchema>;

export const customerNoteBody = z.object({
  body: z.string().trim().min(1, { error: 'Escribí la nota' }).max(2000),
  pinned: z.boolean().default(false),
});

export const updateNoteBody = z.object({ pinned: z.boolean() });
export const noteIdParams = z.object({ customerId: z.uuid(), noteId: z.uuid() });
