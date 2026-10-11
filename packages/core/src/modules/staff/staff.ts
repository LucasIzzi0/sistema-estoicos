import type { Db, Tx } from '@estoicos/db';
import { hashPassword } from '@estoicos/integrations';
import {
  accessLevelOf,
  inviteStaffBody,
  STAFF_AUTH,
  updateStaffBody,
  type InviteStaffBody,
  type StaffMember,
} from '@estoicos/shared';
import type { z } from 'zod';
import { requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps, RequestMeta } from '../../deps';
import { Errors } from '../../errors';
import { writeAudit } from '../audit/audit';
import { findLinkToken, issueLinkToken } from '../auth/codes';
import { createSession, revokeUserSessions } from '../auth/sessions';
import { sendAuthEmail } from '../notifications/auth-emails';
import { staffInvitationEmail } from '../notifications/templates';

const memberInclude = {
  user: { select: { id: true, name: true, email: true, passwordHash: true } },
  branches: { select: { branchId: true } },
} as const;

type MemberRow = Awaited<ReturnType<typeof loadMember>>;

function loadMember(db: Db | Tx, membershipId: string) {
  return db.membership.findUnique({ where: { id: membershipId }, include: memberInclude });
}

function toStaffMember(m: NonNullable<MemberRow>): StaffMember {
  return {
    membershipId: m.id,
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    accessLevel: accessLevelOf(m.role, m.allBranches),
    allBranches: m.allBranches,
    branchIds: m.branches.map((b) => b.branchId),
    active: m.active,
    hasPassword: Boolean(m.user.passwordHash),
  };
}

/** Un encargado solo gestiona recepcionistas cuyas sucursales están todas dentro de las suyas. */
function assertCanManage(
  principal: StaffPrincipal,
  target: { role: string; allBranches: boolean; branchIds: string[] },
) {
  if (principal.accessLevel === 'OWNER') return;
  const withinOwnBranches =
    !target.allBranches && target.branchIds.every((id) => principal.branchIds.includes(id));
  if (target.role !== 'RECEPTION' || !withinOwnBranches) {
    throw Errors.forbidden('Solo el dueño puede gestionar a esta persona.');
  }
}

async function assertBranchesBelongToOrg(db: Db | Tx, organizationId: string, branchIds: string[]) {
  if (branchIds.length === 0) return;
  const count = await db.branch.count({ where: { organizationId, id: { in: branchIds } } });
  if (count !== new Set(branchIds).size) throw Errors.invalid('Alguna de las sucursales elegidas no existe.');
}

export async function listStaff(deps: CoreDeps, principal: StaffPrincipal): Promise<StaffMember[]> {
  requirePermission(principal, 'staff:read');
  const members = await deps.db.membership.findMany({
    where: { organizationId: principal.organizationId },
    include: memberInclude,
    orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
  });
  const all = members.map(toStaffMember);
  if (principal.accessLevel === 'OWNER') return all;
  // El encargado ve a quienes comparten alguna de sus sucursales.
  return all.filter((m) => m.allBranches || m.branchIds.some((id) => principal.branchIds.includes(id)));
}

/**
 * Invita a alguien como usuario del sistema (dueño, encargado o recepción): crea usuario (sin
 * contraseña), membresía y sucursales. Envía un link de un solo uso (72 h) para definir la contraseña.
 * Los barberos NO son usuarios: se gestionan como perfiles en el módulo de barberos.
 * Si la persona ya estaba invitada y no aceptó, se reenvía la invitación.
 */
export async function inviteStaff(
  deps: CoreDeps,
  principal: StaffPrincipal,
  rawBody: InviteStaffBody,
  meta: RequestMeta,
): Promise<StaffMember> {
  requirePermission(principal, 'staff:invite');
  const body = inviteStaffBody.parse(rawBody);
  const allBranches = body.role === 'ADMIN' && body.allBranches;
  assertCanManage(principal, { role: body.role, allBranches, branchIds: body.branchIds });
  await assertBranchesBelongToOrg(deps.db, principal.organizationId, body.branchIds);

  const organization = await deps.db.organization.findUniqueOrThrow({
    where: { id: principal.organizationId },
  });
  const existingUser = await deps.db.user.findUnique({ where: { email: body.email } });
  if (existingUser) {
    const existingMembership = await deps.db.membership.findFirst({
      where: { userId: existingUser.id, organizationId: principal.organizationId },
      include: memberInclude,
    });
    if (existingMembership) {
      if (existingUser.passwordHash) throw Errors.conflict('Esa persona ya es parte del equipo.');
      await sendInvitation(deps, principal, organization.name, existingUser, meta);
      return toStaffMember(existingMembership);
    }
  }

  const membershipId = await deps.db.$transaction(async (tx) => {
    const user =
      existingUser ??
      (await tx.user.create({ data: { email: body.email, name: body.name, passwordHash: null } }));
    const membership = await tx.membership.create({
      data: {
        userId: user.id,
        organizationId: principal.organizationId,
        role: body.role,
        allBranches,
        branches: { create: allBranches ? [] : body.branchIds.map((branchId) => ({ branchId })) },
      },
    });
    await writeAudit(tx, {
      organizationId: principal.organizationId,
      actor: { type: 'STAFF', userId: principal.userId },
      action: 'STAFF_INVITED',
      entityType: 'Membership',
      entityId: membership.id,
      summary: `Invitó a ${body.email} como ${body.role === 'ADMIN' ? 'admin' : 'recepción'}`,
      after: { role: body.role, allBranches, branchIds: body.branchIds },
      meta,
    });
    return membership.id;
  });

  const user = await deps.db.user.findUniqueOrThrow({ where: { email: body.email } });
  await sendInvitation(deps, principal, organization.name, user, meta);
  return toStaffMember((await loadMember(deps.db, membershipId))!);
}

async function sendInvitation(
  deps: CoreDeps,
  principal: StaffPrincipal,
  orgName: string,
  user: { id: string; email: string; name: string },
  meta: RequestMeta,
) {
  const { authCodeId, token } = await issueLinkToken(deps, {
    purpose: 'STAFF_INVITATION',
    organizationId: principal.organizationId,
    email: user.email,
    userId: user.id,
    ttlMinutes: STAFF_AUTH.invitationTtlHours * 60,
    meta,
  });
  await sendAuthEmail(deps, {
    organizationId: principal.organizationId,
    type: 'STAFF_INVITATION',
    to: user.email,
    userId: user.id,
    dedupeKey: `invitation:${authCodeId}`,
    email: staffInvitationEmail({
      orgName,
      name: user.name,
      invitedBy: principal.userName,
      link: `${deps.config.appPublicUrl}/staff/invitacion/${encodeURIComponent(token)}`,
      hours: STAFF_AUTH.invitationTtlHours,
    }),
    logPayload: { authCodeId },
  });
}

export async function getInvitation(deps: CoreDeps, token: string) {
  const code = await findLinkToken(deps, 'STAFF_INVITATION', token);
  if (!code?.userId || !code.organizationId)
    throw Errors.notFound('La invitación venció o ya se usó. Pedí una nueva.');
  const membership = await deps.db.membership.findFirst({
    where: { userId: code.userId, organizationId: code.organizationId, active: true },
    include: { user: true, organization: true },
  });
  if (!membership) throw Errors.notFound('La invitación venció o ya se usó. Pedí una nueva.');
  return {
    email: membership.user.email,
    name: membership.user.name,
    organizationName: membership.organization.name,
    role: membership.role,
    code,
  };
}

/** Acepta la invitación: define la contraseña y abre sesión. */
export async function acceptInvitation(
  deps: CoreDeps,
  input: { token: string; password: string; meta: RequestMeta },
): Promise<{ token: string }> {
  const invitation = await getInvitation(deps, input.token);
  const passwordHash = await hashPassword(input.password);
  const now = deps.now();
  const userId = invitation.code.userId!;
  const organizationId = invitation.code.organizationId!;

  return deps.db.$transaction(async (tx) => {
    const consumed = await tx.authCode.updateMany({
      where: { id: invitation.code.id, consumedAt: null, invalidatedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count === 0) throw Errors.notFound('La invitación venció o ya se usó. Pedí una nueva.');
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.passwordHash) throw Errors.conflict('Ya tenés una cuenta: ingresá con tu contraseña.');
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: now, emailVerifiedAt: now, lastLoginAt: now },
    });
    const { token } = await createSession(tx, {
      kind: 'STAFF',
      organizationId,
      userId,
      ttlDays: STAFF_AUTH.sessionDays,
      meta: input.meta,
      now,
    });
    return { token };
  });
}

/**
 * Cambia rol, sucursales o estado de un miembro. Cualquier cambio cierra sus sesiones
 * abiertas (los permisos nuevos rigen al instante). Nadie se modifica a sí mismo y siempre
 * queda al menos un dueño activo.
 */
export async function updateStaffMember(
  deps: CoreDeps,
  principal: StaffPrincipal,
  membershipId: string,
  rawBody: z.input<typeof updateStaffBody>,
  meta: RequestMeta,
): Promise<StaffMember> {
  requirePermission(principal, 'staff:update');
  const body = updateStaffBody.parse(rawBody);
  const target = await loadMember(deps.db, membershipId);
  if (!target || target.organizationId !== principal.organizationId)
    throw Errors.notFound('No encontramos a esa persona.');
  if (target.id === principal.membershipId) throw Errors.forbidden('No podés modificar tu propio acceso.');

  const before = toStaffMember(target);
  assertCanManage(principal, before);

  const role = body.role ?? target.role;
  const allBranches = role === 'ADMIN' ? (body.allBranches ?? target.allBranches) : false;
  const branchIds = body.branchIds ?? before.branchIds;
  const active = body.active ?? target.active;
  assertCanManage(principal, { role, allBranches, branchIds });
  if (!allBranches && branchIds.length === 0) throw Errors.invalid('Elegí al menos una sucursal.');
  await assertBranchesBelongToOrg(deps.db, principal.organizationId, branchIds);

  const now = deps.now();
  await deps.db.$transaction(async (tx) => {
    const wasOwner = target.role === 'ADMIN' && target.allBranches && target.active;
    const staysOwner = role === 'ADMIN' && allBranches && active;
    if (wasOwner && !staysOwner) {
      const otherOwners = await tx.membership.count({
        where: {
          organizationId: principal.organizationId,
          role: 'ADMIN',
          allBranches: true,
          active: true,
          id: { not: target.id },
        },
      });
      if (otherOwners === 0) throw Errors.conflict('Tiene que quedar al menos un dueño con acceso total.');
    }

    await tx.membership.update({ where: { id: target.id }, data: { role, allBranches, active } });
    await tx.membershipBranch.deleteMany({ where: { membershipId: target.id } });
    if (!allBranches) {
      await tx.membershipBranch.createMany({
        data: branchIds.map((branchId) => ({ membershipId: target.id, branchId })),
      });
    }
    await revokeUserSessions(tx, target.userId, now);

    const after = { role, allBranches, branchIds: allBranches ? [] : branchIds, active };
    const action =
      !active && target.active
        ? 'STAFF_DEACTIVATED'
        : role !== target.role || allBranches !== target.allBranches
          ? 'STAFF_ROLE_CHANGED'
          : 'STAFF_BRANCH_ACCESS_CHANGED';
    await writeAudit(tx, {
      organizationId: principal.organizationId,
      actor: { type: 'STAFF', userId: principal.userId },
      action,
      entityType: 'Membership',
      entityId: target.id,
      summary: `Modificó el acceso de ${target.user.email}`,
      before: {
        role: before.role,
        allBranches: before.allBranches,
        branchIds: before.branchIds,
        active: before.active,
      },
      after,
      meta,
    });
  });

  return toStaffMember((await loadMember(deps.db, target.id))!);
}
