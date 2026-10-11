import type { Db, MemberRole, Session } from '@estoicos/db';
import {
  accessLevelOf,
  hasPermission,
  PERMISSIONS,
  type AccessLevel,
  type Permission,
  type StaffMe,
} from '@estoicos/shared';
import { Errors } from '../errors';

/** Quién hace el pedido (staff), resuelto desde la sesión en CADA pedido. */
export interface StaffPrincipal {
  kind: 'staff';
  sessionId: string;
  userId: string;
  userName: string;
  userEmail: string;
  organizationId: string;
  membershipId: string;
  role: MemberRole;
  allBranches: boolean;
  accessLevel: AccessLevel;
  /** Sucursales permitidas (todas las activas si allBranches). */
  branchIds: string[];
  /** Tiene segundo factor activado y todavía no validó el código en esta sesión. */
  secondFactorPending: boolean;
}

export interface CustomerPrincipal {
  kind: 'customer';
  sessionId: string;
  customerId: string;
  organizationId: string;
}

export async function loadStaffPrincipal(db: Db, session: Session): Promise<StaffPrincipal | null> {
  if (!session.userId) return null;
  const membership = await db.membership.findFirst({
    where: { userId: session.userId, organizationId: session.organizationId, active: true },
    include: { user: true, branches: { select: { branchId: true } } },
  });
  if (!membership || !membership.user.active) return null;

  const branchIds = membership.allBranches
    ? (
        await db.branch.findMany({
          where: { organizationId: membership.organizationId, active: true },
          select: { id: true },
        })
      ).map((b) => b.id)
    : membership.branches.map((b) => b.branchId);

  return {
    kind: 'staff',
    sessionId: session.id,
    userId: membership.userId,
    userName: membership.user.name,
    userEmail: membership.user.email,
    organizationId: membership.organizationId,
    membershipId: membership.id,
    role: membership.role,
    allBranches: membership.allBranches,
    accessLevel: accessLevelOf(membership.role, membership.allBranches),
    branchIds,
    secondFactorPending: membership.user.twoFactorMethod !== 'NONE' && !session.secondFactorVerifiedAt,
  };
}

export function requirePermission(principal: StaffPrincipal, permission: Permission): void {
  if (!hasPermission(principal.accessLevel, permission)) throw Errors.forbidden();
}

export function requireBranchAccess(principal: StaffPrincipal, branchId: string): void {
  if (!principal.branchIds.includes(branchId)) throw Errors.forbidden('No tenés acceso a esta sucursal.');
}

export function permissionsOf(level: AccessLevel): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => hasPermission(level, p));
}

export async function getStaffMe(db: Db, principal: StaffPrincipal): Promise<StaffMe> {
  const [organization, branches] = await Promise.all([
    db.organization.findUniqueOrThrow({
      where: { id: principal.organizationId },
      select: { id: true, name: true, slug: true },
    }),
    db.branch.findMany({
      where: { id: { in: principal.branchIds } },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  return {
    user: { id: principal.userId, name: principal.userName, email: principal.userEmail },
    organization,
    membershipId: principal.membershipId,
    role: principal.role,
    accessLevel: principal.accessLevel,
    allBranches: principal.allBranches,
    branches,
    permissions: permissionsOf(principal.accessLevel),
  };
}
