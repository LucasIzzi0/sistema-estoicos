import type { MpAccount } from '@estoicos/db';
import { HttpMercadoPago, MercadoPagoError, type MercadoPago } from '@estoicos/integrations';
import { connectMpBody, type MpAccountDto, type ConnectMpBody } from '@estoicos/shared';
import { requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps, RequestMeta } from '../../deps';
import { DomainError, Errors, isUniqueViolation } from '../../errors';
import { writeAudit } from '../audit/audit';

/**
 * Vinculación de la cuenta de Mercado Pago (decisión D18): el dueño pega el Access Token y la
 * clave de webhooks de SU aplicación. Los dos se guardan cifrados (AES-256-GCM) y nunca se
 * loguean ni viajan al frontend. OAuth queda para franquicias (el modelo ya lo contempla).
 */
export function mpClientFor(
  deps: CoreDeps,
  account: { accessTokenEnc: string; liveMode: boolean },
): MercadoPago {
  const accessToken = deps.encryptor.decrypt(account.accessTokenEnc);
  return deps.mercadoPago
    ? deps.mercadoPago({ accessToken, liveMode: account.liveMode })
    : new HttpMercadoPago(accessToken);
}

export function mpWebhookSecret(deps: CoreDeps, account: { webhookSecretEnc: string | null }): string | null {
  return account.webhookSecretEnc ? deps.encryptor.decrypt(account.webhookSecretEnc) : null;
}

/** La cuenta activa de la organización (o null si todavía no se vinculó). */
export async function findActiveAccount(deps: CoreDeps, organizationId: string): Promise<MpAccount | null> {
  return deps.db.mpAccount.findFirst({
    where: { organizationId, status: { not: 'DISCONNECTED' } },
    orderBy: { connectedAt: 'desc' },
  });
}

export async function requireActiveAccount(deps: CoreDeps, organizationId: string): Promise<MpAccount> {
  const account = await findActiveAccount(deps, organizationId);
  if (!account || account.status !== 'ACTIVE') {
    throw new DomainError(
      'MP_NOT_CONNECTED',
      'Mercado Pago no está vinculado (o su token dejó de funcionar). Revisá Pagos Mercado Pago.',
      409,
    );
  }
  return account;
}

function toDto(account: MpAccount, terminals: number): MpAccountDto {
  return {
    id: account.id,
    label: account.label,
    mpUserId: account.mpUserId,
    nickname: account.nickname,
    liveMode: account.liveMode,
    status: account.status,
    hasWebhookSecret: !!account.webhookSecretEnc,
    connectedAt: account.connectedAt.toISOString(),
    reconcileFrom: account.reconcileFrom.toISOString(),
    paymentsSyncedUntil: account.paymentsSyncedUntil?.toISOString() ?? null,
    lastError: account.lastError,
    lastErrorAt: account.lastErrorAt?.toISOString() ?? null,
    terminalCount: terminals,
  };
}

export async function getMpAccount(deps: CoreDeps, p: StaffPrincipal): Promise<MpAccountDto | null> {
  requirePermission(p, 'mercadopago:reconcile');
  const account = await findActiveAccount(deps, p.organizationId);
  if (!account) return null;
  const terminals = await deps.db.mpTerminal.count({ where: { mpAccountId: account.id, active: true } });
  return toDto(account, terminals);
}

/** Vincula la cuenta: valida el token contra MP y lo guarda cifrado. */
export async function connectMpAccount(
  deps: CoreDeps,
  p: StaffPrincipal,
  rawBody: ConnectMpBody,
  meta: RequestMeta,
): Promise<MpAccountDto> {
  requirePermission(p, 'mercadopago:connect');
  const body = connectMpBody.parse(rawBody);

  // Se prueba el token ANTES de guardarlo: si no sirve, el dueño se entera al instante.
  const probe = deps.mercadoPago
    ? deps.mercadoPago({ accessToken: body.accessToken, liveMode: !body.accessToken.startsWith('TEST-') })
    : new HttpMercadoPago(body.accessToken);
  let identity: { id: string; nickname?: string | null };
  try {
    identity = await probe.getAccount();
  } catch (error) {
    if (error instanceof MercadoPagoError && error.invalidToken) {
      throw Errors.invalid('Mercado Pago rechazó ese token. Copialo de nuevo desde "Tus integraciones".');
    }
    throw new DomainError(
      'MP_UNAVAILABLE',
      'No pudimos hablar con Mercado Pago. Probá de nuevo en un momento.',
      503,
    );
  }

  const liveMode = !body.accessToken.startsWith('TEST-');
  const now = deps.now();
  const existing = await deps.db.mpAccount.findUnique({ where: { mpUserId: identity.id } });
  if (existing && existing.organizationId !== p.organizationId) {
    throw Errors.conflict('Esa cuenta de Mercado Pago ya está vinculada a otra organización.');
  }

  try {
    const account = await deps.db.$transaction(async (tx) => {
      // Una cuenta activa por organización: la anterior queda desconectada.
      await tx.mpAccount.updateMany({
        where: {
          organizationId: p.organizationId,
          status: { not: 'DISCONNECTED' },
          ...(existing ? { id: { not: existing.id } } : {}),
        },
        data: { status: 'DISCONNECTED', disconnectedAt: now },
      });
      const data = {
        label: body.label,
        nickname: identity.nickname ?? null,
        authMethod: 'MANUAL_TOKEN' as const,
        accessTokenEnc: deps.encryptor.encrypt(body.accessToken),
        webhookSecretEnc: body.webhookSecret ? deps.encryptor.encrypt(body.webhookSecret) : null,
        liveMode,
        status: 'ACTIVE' as const,
        lastError: null,
        lastErrorAt: null,
        disconnectedAt: null,
        connectedById: p.userId,
        connectedAt: now,
      };
      const saved = existing
        ? await tx.mpAccount.update({ where: { id: existing.id }, data })
        : await tx.mpAccount.create({
            data: {
              ...data,
              organizationId: p.organizationId,
              mpUserId: identity.id,
              // Los pagos anteriores a la vinculación no ensucian la bandeja.
              reconcileFrom: now,
            },
          });
      await writeAudit(tx, {
        organizationId: p.organizationId,
        actor: { type: 'STAFF', userId: p.userId },
        action: 'MP_ACCOUNT_CONNECTED',
        entityType: 'MpAccount',
        entityId: saved.id,
        summary: `Cuenta de Mercado Pago vinculada (${identity.nickname ?? identity.id}, ${liveMode ? 'producción' : 'prueba'})`,
        // Nunca se auditan los tokens.
        after: { mpUserId: identity.id, liveMode, hasWebhookSecret: !!body.webhookSecret },
        meta,
      });
      return saved;
    });
    return toDto(
      account,
      await deps.db.mpTerminal.count({ where: { mpAccountId: account.id, active: true } }),
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw Errors.conflict('Esa cuenta de Mercado Pago ya está vinculada.');
    throw error;
  }
}

export async function disconnectMpAccount(
  deps: CoreDeps,
  p: StaffPrincipal,
  meta: RequestMeta,
): Promise<{ ok: true }> {
  requirePermission(p, 'mercadopago:connect');
  const account = await findActiveAccount(deps, p.organizationId);
  if (!account) throw Errors.notFound('No hay ninguna cuenta vinculada.');
  const pending = await deps.db.mpOrder.count({ where: { mpAccountId: account.id, status: 'PENDING' } });
  if (pending > 0) throw Errors.conflict('Hay cobros esperando en una terminal. Esperá a que terminen.');

  await deps.db.$transaction(async (tx) => {
    await tx.mpAccount.update({
      where: { id: account.id },
      data: {
        status: 'DISCONNECTED',
        disconnectedAt: deps.now(),
        accessTokenEnc: '',
        webhookSecretEnc: null,
      },
    });
    await tx.mpTerminal.updateMany({ where: { mpAccountId: account.id }, data: { active: false } });
    await writeAudit(tx, {
      organizationId: p.organizationId,
      actor: { type: 'STAFF', userId: p.userId },
      action: 'MP_ACCOUNT_DISCONNECTED',
      entityType: 'MpAccount',
      entityId: account.id,
      summary: 'Cuenta de Mercado Pago desvinculada (se borró el token guardado)',
      meta,
    });
  });
  return { ok: true };
}

/** Marca la cuenta con error (token vencido, MP caído): se ve en el panel. */
export async function markAccountError(deps: CoreDeps, accountId: string, message: string): Promise<void> {
  await deps.db.mpAccount.update({
    where: { id: accountId },
    data: { status: 'ERROR', lastError: message.slice(0, 500), lastErrorAt: deps.now() },
  });
}

export async function clearAccountError(deps: CoreDeps, account: MpAccount): Promise<void> {
  if (account.status === 'ACTIVE' && !account.lastError) return;
  await deps.db.mpAccount.update({
    where: { id: account.id },
    data: { status: 'ACTIVE', lastError: null, lastErrorAt: null },
  });
}
