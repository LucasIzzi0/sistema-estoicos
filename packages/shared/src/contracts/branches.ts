import { z } from 'zod';
import { dateSchema, emailSchema, optionalText } from './common';

export const branchDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  timezone: z.string(),
  googleReviewUrl: z.string().nullable(),
  bookingEnabled: z.boolean(),
  active: z.boolean(),
});
export type BranchDetail = z.infer<typeof branchDetailSchema>;

const branchFields = {
  name: z.string().trim().min(1, { error: 'Poné un nombre' }).max(60),
  /** Se usa en el link público de reservas: /reservar/<slug>. */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: 'Usá minúsculas, números y guiones (ej. palermo-soho)' })
    .max(40),
  address: optionalText(120),
  city: optionalText(60),
  province: optionalText(60),
  phone: optionalText(30),
  email: emailSchema.nullish().transform((v) => v ?? null),
  googleReviewUrl: z
    .url({ protocol: /^https$/, error: 'Pegá el link completo que empieza con https://' })
    .nullish()
    .transform((v) => v ?? null),
  bookingEnabled: z.boolean(),
  active: z.boolean(),
};

export const createBranchBody = z.object({
  ...branchFields,
  bookingEnabled: branchFields.bookingEnabled.default(true),
  active: branchFields.active.default(true),
});
export type CreateBranchBody = z.input<typeof createBranchBody>;

export const updateBranchBody = z.object(branchFields).partial();
export type UpdateBranchBody = z.input<typeof updateBranchBody>;

/** Cierre de toda la sucursal (feriado, reforma): uno o varios días completos. */
export const closureSchema = z.object({
  id: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  reason: z.string(),
});
export type ClosureDto = z.infer<typeof closureSchema>;

export const createClosureBody = z.object({
  date: dateSchema,
  endDate: dateSchema.nullish(),
  reason: z.string().trim().min(1, { error: 'Indicá el motivo (ej. Feriado 9 de julio)' }).max(100),
});

export const closureIdParams = z.object({ branchId: z.uuid(), closureId: z.uuid() });
