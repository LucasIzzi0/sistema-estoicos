import { z } from 'zod';
import { ACCESS_LEVELS, STAFF_ROLES } from '../permissions';
import { emailSchema, mobilePhoneSchema, passwordSchema, personNameSchema } from './common';

// ---------------------------------------------------------------------------
// Clientes: acceso con código por email
// ---------------------------------------------------------------------------

export const customerRequestCodeBody = z.object({ email: emailSchema });
export type CustomerRequestCodeBody = z.infer<typeof customerRequestCodeBody>;

export const customerVerifyCodeBody = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, { error: 'El código tiene 6 números' }),
});
export type CustomerVerifyCodeBody = z.infer<typeof customerVerifyCodeBody>;

export const notificationChannelSchema = z.enum(['WHATSAPP', 'EMAIL']);

export const customerMeSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  preferredChannel: notificationChannelSchema,
  consents: z.object({
    transactional: z.boolean(),
    marketing: z.boolean(),
  }),
  /** El cliente todavía no completó nombre y celular. */
  needsProfile: z.boolean(),
});
export type CustomerMe = z.infer<typeof customerMeSchema>;

export const customerProfileBody = z.object({
  firstName: personNameSchema,
  lastName: personNameSchema,
  phone: mobilePhoneSchema,
  preferredChannel: notificationChannelSchema.default('WHATSAPP'),
  /** Avisos de turnos (confirmación, recordatorio, cancelación) por WhatsApp y email. */
  acceptTransactional: z.boolean(),
  /** Promociones, recordatorios de volver y pedidos de reseña. */
  acceptMarketing: z.boolean(),
});
export type CustomerProfileBody = z.input<typeof customerProfileBody>;

// ---------------------------------------------------------------------------
// Staff: contraseña, segundo factor, invitaciones y recuperación
// ---------------------------------------------------------------------------

export const staffLoginBody = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: 'Ingresá tu contraseña' }).max(128),
});
export type StaffLoginBody = z.infer<typeof staffLoginBody>;

export const staffSecondFactorBody = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, { error: 'El código tiene 6 números' }),
});

export const passwordResetRequestBody = z.object({ email: emailSchema });

export const passwordResetConfirmBody = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const invitationTokenParams = z.object({ token: z.string().min(20).max(200) });

export const invitationInfoSchema = z.object({
  email: z.string(),
  name: z.string(),
  organizationName: z.string(),
  role: z.enum(STAFF_ROLES),
});

export const acceptInvitationBody = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const branchSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});
export type BranchSummary = z.infer<typeof branchSummarySchema>;

export const staffMeSchema = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  organization: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  membershipId: z.string(),
  role: z.enum(STAFF_ROLES),
  accessLevel: z.enum(ACCESS_LEVELS),
  allBranches: z.boolean(),
  branches: z.array(branchSummarySchema),
  permissions: z.array(z.string()),
});
export type StaffMe = z.infer<typeof staffMeSchema>;

export const staffLoginResponse = z.object({
  /** true: se envió un código por email y falta validarlo (segundo factor activado). */
  requiresSecondFactor: z.boolean(),
  me: staffMeSchema.nullable(),
});
export type StaffLoginResponse = z.infer<typeof staffLoginResponse>;
