import type { Db, Prisma } from '@estoicos/db';
import { sha256Hex } from '@estoicos/integrations';
import { DomainError, isUniqueViolation } from '../../errors';

/**
 * Idempotency-Key para lo que mueve plata (cobrar, anular). El mismo pedido repetido (doble
 * clic, reintento de red) devuelve la MISMA respuesta sin volver a ejecutarse. La clave vive 24 h.
 * Si el pedido falla, la clave se libera para poder reintentar.
 */
export async function runIdempotent<T>(
  db: Db,
  input: { scope: string; key: string | undefined; request: unknown; now: Date },
  fn: () => Promise<T>,
): Promise<T> {
  if (!input.key) return fn();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.key)) {
    throw new DomainError('INVALID', 'Idempotency-Key inválida.', 422);
  }
  const requestHash = sha256Hex(JSON.stringify(input.request ?? null));
  const where = { scope_key: { scope: input.scope, key: input.key } };

  try {
    await db.apiIdempotencyKey.create({
      data: {
        scope: input.scope,
        key: input.key,
        requestHash,
        expiresAt: new Date(input.now.getTime() + 24 * 3600_000),
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await db.apiIdempotencyKey.findUnique({ where });
    if (!existing) return runIdempotent(db, input, fn);
    if (existing.requestHash !== requestHash) {
      throw new DomainError('IDEMPOTENCY_MISMATCH', 'Esa clave ya se usó con otro pedido.', 422);
    }
    if (existing.responseStatus === null) {
      throw new DomainError('IN_PROGRESS', 'Ya se está procesando. Esperá un momento.', 409);
    }
    return existing.responseBody as T;
  }

  try {
    const result = await fn();
    await db.apiIdempotencyKey.update({
      where,
      data: { responseStatus: 200, responseBody: result as unknown as Prisma.InputJsonValue },
    });
    return result;
  } catch (error) {
    await db.apiIdempotencyKey.delete({ where }).catch(() => undefined);
    throw error;
  }
}
