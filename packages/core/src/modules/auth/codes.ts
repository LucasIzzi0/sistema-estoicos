import type { AuthCode, AuthCodePurpose } from '@estoicos/db';
import { hmacSha256Hex, numericCode, randomToken, safeEqual, sha256Hex } from '@estoicos/integrations';
import type { CoreDeps, RequestMeta } from '../../deps';
import { Errors } from '../../errors';

const MINUTE_MS = 60_000;

interface IssueBase {
  purpose: AuthCodePurpose;
  organizationId: string;
  email: string;
  userId?: string;
  customerId?: string;
  ttlMinutes: number;
  meta: RequestMeta;
}

function codeHash(
  secret: string,
  purpose: AuthCodePurpose,
  organizationId: string,
  email: string,
  code: string,
) {
  return hmacSha256Hex(secret, `${purpose}:${organizationId}:${email}:${code}`);
}

/**
 * Emite un código numérico de 6 dígitos. Se guarda solo su HMAC y pedir uno nuevo invalida
 * los anteriores del mismo email y propósito.
 */
export async function issueNumericCode(
  deps: CoreDeps,
  input: IssueBase & { maxAttempts: number },
): Promise<{ authCodeId: string; code: string }> {
  const now = deps.now();
  const code = numericCode(6);
  const created = await deps.db.$transaction(async (tx) => {
    await tx.authCode.updateMany({
      where: {
        purpose: input.purpose,
        organizationId: input.organizationId,
        email: input.email,
        consumedAt: null,
        invalidatedAt: null,
      },
      data: { invalidatedAt: now },
    });
    return tx.authCode.create({
      data: {
        purpose: input.purpose,
        organizationId: input.organizationId,
        email: input.email,
        userId: input.userId ?? null,
        customerId: input.customerId ?? null,
        codeHash: codeHash(
          deps.config.authCodeSecret,
          input.purpose,
          input.organizationId,
          input.email,
          code,
        ),
        expiresAt: new Date(now.getTime() + input.ttlMinutes * MINUTE_MS),
        maxAttempts: input.maxAttempts,
        requestIp: input.meta.ip ?? null,
        userAgent: input.meta.userAgent?.slice(0, 400) ?? null,
      },
    });
  });
  return { authCodeId: created.id, code };
}

/**
 * Valida un código numérico. Cada intento se cuenta de forma atómica (no se puede superar
 * el máximo aunque lleguen pedidos simultáneos). Si es correcto, se consume.
 */
export async function verifyNumericCode(
  deps: CoreDeps,
  input: { purpose: AuthCodePurpose; organizationId: string; email: string; code: string },
): Promise<AuthCode> {
  const now = deps.now();
  const current = await deps.db.authCode.findFirst({
    where: {
      purpose: input.purpose,
      organizationId: input.organizationId,
      email: input.email,
      consumedAt: null,
      invalidatedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!current || current.expiresAt <= now) {
    throw Errors.invalidCode('El código venció o no es válido. Pedí uno nuevo.');
  }

  const bumped = await deps.db.authCode.updateMany({
    where: { id: current.id, attempts: { lt: current.maxAttempts }, consumedAt: null, invalidatedAt: null },
    data: { attempts: { increment: 1 } },
  });
  if (bumped.count === 0) {
    throw Errors.invalidCode('Superaste la cantidad de intentos. Pedí un código nuevo.');
  }

  const attempts = current.attempts + 1;
  const expected = codeHash(
    deps.config.authCodeSecret,
    input.purpose,
    input.organizationId,
    input.email,
    input.code,
  );
  if (!safeEqual(expected, current.codeHash)) {
    const remaining = current.maxAttempts - attempts;
    if (remaining <= 0) {
      await deps.db.authCode.update({ where: { id: current.id }, data: { invalidatedAt: now } });
      throw Errors.invalidCode('Superaste la cantidad de intentos. Pedí un código nuevo.');
    }
    throw Errors.invalidCode(
      `El código no es correcto. Te ${remaining === 1 ? 'queda 1 intento' : `quedan ${remaining} intentos`}.`,
    );
  }

  const consumed = await deps.db.authCode.updateMany({
    where: { id: current.id, consumedAt: null, invalidatedAt: null },
    data: { consumedAt: now },
  });
  if (consumed.count === 0) throw Errors.invalidCode('El código ya fue usado. Pedí uno nuevo.');
  return current;
}

/** Emite un token largo para links (invitación, recuperación de contraseña). Se guarda su SHA-256. */
export async function issueLinkToken(
  deps: CoreDeps,
  input: IssueBase,
): Promise<{ authCodeId: string; token: string }> {
  const now = deps.now();
  const token = randomToken(32);
  const created = await deps.db.$transaction(async (tx) => {
    await tx.authCode.updateMany({
      where: { purpose: input.purpose, email: input.email, consumedAt: null, invalidatedAt: null },
      data: { invalidatedAt: now },
    });
    return tx.authCode.create({
      data: {
        purpose: input.purpose,
        organizationId: input.organizationId,
        email: input.email,
        userId: input.userId ?? null,
        codeHash: sha256Hex(token),
        expiresAt: new Date(now.getTime() + input.ttlMinutes * MINUTE_MS),
        maxAttempts: 1,
        requestIp: input.meta.ip ?? null,
        userAgent: input.meta.userAgent?.slice(0, 400) ?? null,
      },
    });
  });
  return { authCodeId: created.id, token };
}

/** Busca un token de link vigente (sin consumirlo). */
export async function findLinkToken(
  deps: CoreDeps,
  purpose: AuthCodePurpose,
  token: string,
): Promise<AuthCode | null> {
  const found = await deps.db.authCode.findFirst({ where: { purpose, codeHash: sha256Hex(token) } });
  if (!found || found.consumedAt || found.invalidatedAt || found.expiresAt <= deps.now()) return null;
  return found;
}

/** Cuántos códigos se pidieron para un email en una ventana de tiempo (límites por email). */
export async function countRecentCodes(
  deps: CoreDeps,
  input: { purpose: AuthCodePurpose; organizationId: string; email: string; sinceMinutes: number },
): Promise<number> {
  return deps.db.authCode.count({
    where: {
      purpose: input.purpose,
      organizationId: input.organizationId,
      email: input.email,
      createdAt: { gte: new Date(deps.now().getTime() - input.sinceMinutes * MINUTE_MS) },
    },
  });
}
