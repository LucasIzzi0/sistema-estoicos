import type { ActorType, AuditAction, Prisma, Tx } from '@estoicos/db';
import type { RequestMeta } from '../../deps';

export interface AuditEntry {
  organizationId: string | null;
  branchId?: string | null;
  actor: { type: ActorType; userId?: string | null; customerId?: string | null };
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  reason?: string;
  meta?: RequestMeta;
}

/**
 * Registra una acción sensible. Se llama DENTRO de la misma transacción que la acción:
 * si la acción se revierte, la auditoría también. La tabla es de solo inserción.
 */
export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      branchId: entry.branchId ?? null,
      actorType: entry.actor.type,
      actorUserId: entry.actor.userId ?? null,
      actorCustomerId: entry.actor.customerId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary ?? null,
      before: entry.before,
      after: entry.after,
      reason: entry.reason ?? null,
      ipAddress: entry.meta?.ip ?? null,
      userAgent: entry.meta?.userAgent ?? null,
      requestId: entry.meta?.requestId ?? null,
    },
  });
}
