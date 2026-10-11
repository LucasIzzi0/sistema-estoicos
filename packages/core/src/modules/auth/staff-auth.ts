import { burnPasswordCheck, hashPassword, verifyPassword } from '@estoicos/integrations';
import { STAFF_AUTH } from '@estoicos/shared';
import type { StaffPrincipal } from '../../authz/principal';
import type { CoreDeps, RequestMeta } from '../../deps';
import { Errors } from '../../errors';
import { writeAudit } from '../audit/audit';
import { sendAuthEmail } from '../notifications/auth-emails';
import { passwordResetEmail, secondFactorEmail } from '../notifications/templates';
import type { OrganizationRef } from '../organization/organization';
import {
  countRecentCodes,
  findLinkToken,
  issueLinkToken,
  issueNumericCode,
  verifyNumericCode,
} from './codes';
import { createSession, revokeUserSessions } from './sessions';

const MINUTE_MS = 60_000;

/**
 * Login del staff con email y contraseña.
 * - Mismo mensaje si el email no existe o la contraseña es incorrecta (y mismo tiempo de respuesta).
 * - 5 fallos seguidos bloquean la cuenta 15 minutos.
 * - Si el usuario tiene segundo factor, la sesión queda pendiente hasta validar el código por email.
 */
export async function loginStaff(
  deps: CoreDeps,
  input: { organization: OrganizationRef; email: string; password: string; meta: RequestMeta },
): Promise<{ token: string; requiresSecondFactor: boolean }> {
  const now = deps.now();
  const user = await deps.db.user.findUnique({ where: { email: input.email } });
  if (!user || !user.passwordHash) {
    await burnPasswordCheck(input.password);
    throw Errors.invalidCredentials();
  }
  if (user.lockedUntil && user.lockedUntil > now) {
    throw Errors.accountLocked(Math.ceil((user.lockedUntil.getTime() - now.getTime()) / MINUTE_MS));
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    const failed = user.failedLoginAttempts + 1;
    const lock = failed >= STAFF_AUTH.maxFailedLogins;
    await deps.db.user.update({
      where: { id: user.id },
      data: lock
        ? {
            failedLoginAttempts: 0,
            lockedUntil: new Date(now.getTime() + STAFF_AUTH.lockMinutes * MINUTE_MS),
          }
        : { failedLoginAttempts: failed },
    });
    deps.log.warn({ userId: user.id, ip: input.meta.ip, locked: lock }, 'Login de staff fallido');
    if (lock) throw Errors.accountLocked(STAFF_AUTH.lockMinutes);
    throw Errors.invalidCredentials();
  }
  if (!user.active) throw Errors.invalidCredentials();

  const membership = await deps.db.membership.findFirst({
    where: { userId: user.id, organizationId: input.organization.id, active: true },
  });
  if (!membership) throw Errors.forbidden('Tu usuario no tiene acceso a este sistema. Hablá con el dueño.');

  await deps.db.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now },
  });

  const requiresSecondFactor = user.twoFactorMethod === 'EMAIL_CODE';
  const { token } = await createSession(deps.db, {
    kind: 'STAFF',
    organizationId: input.organization.id,
    userId: user.id,
    ttlDays: STAFF_AUTH.sessionDays,
    secondFactorVerified: !requiresSecondFactor,
    meta: input.meta,
    now,
  });

  if (requiresSecondFactor) {
    const { authCodeId, code } = await issueNumericCode(deps, {
      purpose: 'STAFF_SECOND_FACTOR',
      organizationId: input.organization.id,
      email: user.email,
      userId: user.id,
      ttlMinutes: STAFF_AUTH.secondFactorTtlMinutes,
      maxAttempts: 5,
      meta: input.meta,
    });
    await sendAuthEmail(deps, {
      organizationId: input.organization.id,
      type: 'STAFF_SECOND_FACTOR',
      to: user.email,
      userId: user.id,
      dedupeKey: `second-factor:${authCodeId}`,
      email: secondFactorEmail({
        orgName: input.organization.name,
        code,
        minutes: STAFF_AUTH.secondFactorTtlMinutes,
      }),
      logPayload: { authCodeId },
    });
  }
  return { token, requiresSecondFactor };
}

export async function verifyStaffSecondFactor(
  deps: CoreDeps,
  principal: StaffPrincipal,
  code: string,
): Promise<void> {
  await verifyNumericCode(deps, {
    purpose: 'STAFF_SECOND_FACTOR',
    organizationId: principal.organizationId,
    email: principal.userEmail,
    code,
  });
  await deps.db.session.update({
    where: { id: principal.sessionId },
    data: { secondFactorVerifiedAt: deps.now() },
  });
}

/** Pide el link para cambiar la contraseña. Responde igual exista o no el email. */
export async function requestPasswordReset(
  deps: CoreDeps,
  input: { organization: OrganizationRef; email: string; meta: RequestMeta },
): Promise<void> {
  const user = await deps.db.user.findUnique({ where: { email: input.email } });
  if (!user || !user.active || !user.passwordHash) return;

  const recent = await countRecentCodes(deps, {
    purpose: 'STAFF_PASSWORD_RESET',
    organizationId: input.organization.id,
    email: user.email,
    sinceMinutes: 15,
  });
  if (recent >= 3) return;

  const { authCodeId, token } = await issueLinkToken(deps, {
    purpose: 'STAFF_PASSWORD_RESET',
    organizationId: input.organization.id,
    email: user.email,
    userId: user.id,
    ttlMinutes: STAFF_AUTH.passwordResetTtlMinutes,
    meta: input.meta,
  });
  await sendAuthEmail(deps, {
    organizationId: input.organization.id,
    type: 'STAFF_PASSWORD_RESET',
    to: user.email,
    userId: user.id,
    dedupeKey: `password-reset:${authCodeId}`,
    email: passwordResetEmail({
      orgName: input.organization.name,
      name: user.name,
      link: `${deps.config.appPublicUrl}/staff/recuperar?token=${encodeURIComponent(token)}`,
      minutes: STAFF_AUTH.passwordResetTtlMinutes,
    }),
    logPayload: { authCodeId },
  });
}

/** Define la contraseña nueva con el link. Cierra todas las sesiones abiertas del usuario. */
export async function confirmPasswordReset(
  deps: CoreDeps,
  input: { token: string; password: string; meta: RequestMeta },
): Promise<void> {
  const code = await findLinkToken(deps, 'STAFF_PASSWORD_RESET', input.token);
  if (!code?.userId) throw Errors.invalidCode('El link venció o ya se usó. Pedí uno nuevo.');
  const passwordHash = await hashPassword(input.password);
  const now = deps.now();

  await deps.db.$transaction(async (tx) => {
    const consumed = await tx.authCode.updateMany({
      where: { id: code.id, consumedAt: null, invalidatedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count === 0) throw Errors.invalidCode('El link venció o ya se usó. Pedí uno nuevo.');
    await tx.user.update({
      where: { id: code.userId! },
      data: { passwordHash, passwordChangedAt: now, failedLoginAttempts: 0, lockedUntil: null },
    });
    await revokeUserSessions(tx, code.userId!, now);
    await writeAudit(tx, {
      organizationId: code.organizationId,
      actor: { type: 'STAFF', userId: code.userId },
      action: 'STAFF_PASSWORD_RESET',
      entityType: 'User',
      entityId: code.userId,
      summary: 'Cambio de contraseña por link de recuperación',
      meta: input.meta,
    });
  });
}
