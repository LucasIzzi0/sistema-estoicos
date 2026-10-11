import { z } from 'zod';
import { ACCESS_LEVELS, STAFF_ROLES } from '../permissions';
import { emailSchema, personNameSchema } from './common';

export const inviteStaffBody = z
  .object({
    email: emailSchema,
    name: personNameSchema,
    role: z.enum(STAFF_ROLES),
    /** Solo para ADMIN: acceso a todas las sucursales (dueño). */
    allBranches: z.boolean().default(false),
    branchIds: z.array(z.uuid()).default([]),
  })
  .refine((v) => v.allBranches || v.branchIds.length > 0, {
    error: 'Elegí al menos una sucursal',
    path: ['branchIds'],
  })
  .refine((v) => !(v.role === 'RECEPTION' && v.allBranches), {
    error: 'Recepción no puede tener acceso a todas las sucursales',
    path: ['allBranches'],
  });
export type InviteStaffBody = z.input<typeof inviteStaffBody>;

export const updateStaffBody = z.object({
  role: z.enum(STAFF_ROLES).optional(),
  allBranches: z.boolean().optional(),
  branchIds: z.array(z.uuid()).optional(),
  active: z.boolean().optional(),
});

export const membershipIdParams = z.object({ membershipId: z.uuid() });

export const staffMemberSchema = z.object({
  membershipId: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(STAFF_ROLES),
  accessLevel: z.enum(ACCESS_LEVELS),
  allBranches: z.boolean(),
  branchIds: z.array(z.string()),
  active: z.boolean(),
  /** false = invitación pendiente (todavía no definió su contraseña). */
  hasPassword: z.boolean(),
});
export type StaffMember = z.infer<typeof staffMemberSchema>;
