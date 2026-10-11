import type { Db, Session, SessionKind, Tx } from '@estoicos/db';
import { randomToken, sha256Hex } from '@estoicos/integrations';
import type { RequestMeta } from '../../deps';

const DAY_MS = 24 * 60 * 60 * 1000;
/** `last_seen_at` y la renovación se escriben como máximo cada 5 minutos. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface CreateSessionInput {
  kind: SessionKind;
  organizationId: string;
  userId?: string;
  customerId?: string;
  ttlDays: number;
  /** false cuando el usuario tiene segundo factor y todavía no validó el código. */
  secondFactorVerified?: boolean;
  meta: RequestMeta;
  now: Date;
}

/**
 * Sesión opaca: el token viaja SOLO en la cookie; en la base queda su SHA-256.
 * Devuelve el token en claro una única vez.
 */
export async function createSession(
  db: Db | Tx,
  input: CreateSessionInput,
): Promise<{ token: string; session: Session }> {
  const token = randomToken(32);
  const session = await db.session.create({
    data: {
      tokenHash: sha256Hex(token),
      kind: input.kind,
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      customerId: input.customerId ?? null,
      expiresAt: new Date(input.now.getTime() + input.ttlDays * DAY_MS),
      lastSeenAt: input.now,
      secondFactorVerifiedAt: input.secondFactorVerified === false ? null : input.now,
      ipAddress: input.meta.ip ?? null,
      userAgent: input.meta.userAgent?.slice(0, 400) ?? null,
    },
  });
  return { token, session };
}

/**
 * Busca una sesión vigente por su token. Renueva el vencimiento con el uso (sesión deslizante).
 * Devuelve null si no existe, venció, fue revocada o es de otro tipo.
 */
export async function resolveSession(
  db: Db,
  token: string,
  kind: SessionKind,
  ttlDays: number,
  now: Date,
): Promise<Session | null> {
  if (!token || token.length > 200) return null;
  const session = await db.session.findUnique({ where: { tokenHash: sha256Hex(token) } });
  if (!session || session.kind !== kind || session.revokedAt || session.expiresAt <= now) return null;

  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    const expiresAt = new Date(now.getTime() + ttlDays * DAY_MS);
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: now, expiresAt } });
    return { ...session, lastSeenAt: now, expiresAt };
  }
  return session;
}

export async function revokeSessionByToken(db: Db, token: string, now: Date): Promise<void> {
  await db.session.updateMany({
    where: { tokenHash: sha256Hex(token), revokedAt: null },
    data: { revokedAt: now },
  });
}

/** Cierra todas las sesiones de un usuario del staff (baja, cambio de rol, cambio de contraseña). */
export async function revokeUserSessions(db: Db | Tx, userId: string, now: Date): Promise<number> {
  const result = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  return result.count;
}
