import { MercadoPagoError } from '@estoicos/integrations';
import { updateTerminalBody, type MpTerminalDto, type UpdateTerminalBody } from '@estoicos/shared';
import { requireBranchAccess, requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps, RequestMeta } from '../../deps';
import { DomainError, Errors } from '../../errors';
import { writeAudit } from '../audit/audit';
import { markAccountError, mpClientFor, requireActiveAccount } from './account';

/**
 * Terminales Point. Reglas de Mercado Pago (docs/fase-0/01-arquitectura.md §9.2):
 * cada terminal va asociada a una "sucursal" y una "caja" de MP, cada caja admite UNA sola
 * terminal en modo PDV, y después de pasarla a PDV hay que **reiniciar la terminal**.
 */
async function listRows(deps: CoreDeps, organizationId: string): Promise<MpTerminalDto[]> {
  const rows = await deps.db.mpTerminal.findMany({
    where: { account: { organizationId } },
    include: { branch: { select: { name: true } } },
    orderBy: [{ active: 'desc' }, { externalId: 'asc' }],
  });
  const busy = new Set(
    (
      await deps.db.mpOrder.findMany({
        where: { status: 'PENDING', terminal: { account: { organizationId } } },
        select: { terminalId: true },
      })
    ).map((o) => o.terminalId),
  );
  return rows.map((t) => ({
    id: t.id,
    externalId: t.externalId,
    label: t.label,
    branchId: t.branchId,
    branchName: t.branch?.name ?? null,
    operatingMode: t.operatingMode,
    active: t.active,
    lastSyncedAt: t.lastSyncedAt?.toISOString() ?? null,
    busy: busy.has(t.id),
  }));
}

export async function listTerminals(deps: CoreDeps, p: StaffPrincipal): Promise<MpTerminalDto[]> {
  requirePermission(p, 'mercadopago:reconcile');
  return listRows(deps, p.organizationId);
}

/** Trae las terminales de la cuenta de MP y las guarda (las que ya no están se desactivan). */
export async function syncTerminals(deps: CoreDeps, p: StaffPrincipal): Promise<MpTerminalDto[]> {
  requirePermission(p, 'mercadopago:connect');
  const account = await requireActiveAccount(deps, p.organizationId);
  const client = mpClientFor(deps, account);
  let remote;
  try {
    remote = await client.listTerminals();
  } catch (error) {
    const message = error instanceof MercadoPagoError ? error.message : String(error);
    if (error instanceof MercadoPagoError && error.invalidToken)
      await markAccountError(deps, account.id, message);
    throw new DomainError('MP_UNAVAILABLE', `Mercado Pago no respondió: ${message}`, 503);
  }

  const now = deps.now();
  await deps.db.$transaction(async (tx) => {
    for (const terminal of remote) {
      const mode =
        terminal.operating_mode === 'PDV'
          ? 'PDV'
          : terminal.operating_mode === 'STANDALONE'
            ? 'STANDALONE'
            : 'UNDEFINED';
      await tx.mpTerminal.upsert({
        where: { mpAccountId_externalId: { mpAccountId: account.id, externalId: terminal.id } },
        create: {
          mpAccountId: account.id,
          externalId: terminal.id,
          operatingMode: mode,
          mpStoreId: terminal.store_id ?? null,
          mpPosId: terminal.pos_id === null || terminal.pos_id === undefined ? null : String(terminal.pos_id),
          lastSyncedAt: now,
        },
        update: {
          operatingMode: mode,
          mpStoreId: terminal.store_id ?? null,
          mpPosId: terminal.pos_id === null || terminal.pos_id === undefined ? null : String(terminal.pos_id),
          lastSyncedAt: now,
          active: true,
        },
      });
    }
    // Las que Mercado Pago ya no lista quedan inactivas (no se borran: pueden tener historial).
    await tx.mpTerminal.updateMany({
      where: { mpAccountId: account.id, externalId: { notIn: remote.map((t) => t.id) } },
      data: { active: false },
    });
  });
  return listRows(deps, p.organizationId);
}

export async function updateTerminal(
  deps: CoreDeps,
  p: StaffPrincipal,
  terminalId: string,
  rawBody: UpdateTerminalBody,
  meta: RequestMeta,
): Promise<MpTerminalDto[]> {
  requirePermission(p, 'mercadopago:connect');
  const body = updateTerminalBody.parse(rawBody);
  const terminal = await deps.db.mpTerminal.findFirst({
    where: { id: terminalId, account: { organizationId: p.organizationId } },
  });
  if (!terminal) throw Errors.notFound('No encontramos esa terminal.');
  if (body.branchId) requireBranchAccess(p, body.branchId);
  if (body.active === false || body.branchId === null) {
    const pending = await deps.db.mpOrder.count({ where: { terminalId, status: 'PENDING' } });
    if (pending > 0) throw Errors.conflict('Esa terminal tiene un cobro esperando.');
  }

  await deps.db.$transaction(async (tx) => {
    await tx.mpTerminal.update({
      where: { id: terminalId },
      data: {
        ...(body.branchId !== undefined ? { branchId: body.branchId } : {}),
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });
    if (body.branchId !== undefined) {
      await writeAudit(tx, {
        organizationId: p.organizationId,
        branchId: body.branchId,
        actor: { type: 'STAFF', userId: p.userId },
        action: 'MP_TERMINAL_ASSIGNED',
        entityType: 'MpTerminal',
        entityId: terminalId,
        summary: body.branchId ? 'Terminal asignada a una sucursal' : 'Terminal sin sucursal',
        after: { branchId: body.branchId, label: body.label ?? terminal.label },
        meta,
      });
    }
  });
  return listRows(deps, p.organizationId);
}

/**
 * Pasa la terminal a modo PDV, que es el único en el que recibe nuestros cobros.
 * Después hay que REINICIARLA para que tome el cambio (regla de Mercado Pago).
 */
export async function setTerminalPdvMode(
  deps: CoreDeps,
  p: StaffPrincipal,
  terminalId: string,
  mode: 'PDV' | 'STANDALONE',
): Promise<MpTerminalDto[]> {
  requirePermission(p, 'mercadopago:connect');
  const account = await requireActiveAccount(deps, p.organizationId);
  const terminal = await deps.db.mpTerminal.findFirst({ where: { id: terminalId, mpAccountId: account.id } });
  if (!terminal) throw Errors.notFound('No encontramos esa terminal.');

  try {
    const updated = await mpClientFor(deps, account).setTerminalMode(terminal.externalId, mode);
    await deps.db.mpTerminal.update({
      where: { id: terminalId },
      data: {
        operatingMode: updated.operating_mode === 'PDV' ? 'PDV' : 'STANDALONE',
        lastSyncedAt: deps.now(),
      },
    });
  } catch (error) {
    const message = error instanceof MercadoPagoError ? error.message : String(error);
    if (error instanceof MercadoPagoError && error.invalidToken)
      await markAccountError(deps, account.id, message);
    throw new DomainError('MP_UNAVAILABLE', `Mercado Pago no aceptó el cambio: ${message}`, 503);
  }
  return listRows(deps, p.organizationId);
}
