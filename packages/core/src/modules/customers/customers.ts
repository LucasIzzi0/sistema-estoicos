import type { ConsentSource, Customer, Prisma, Tx } from '@estoicos/db';
import {
  CONSENT_POLICY_VERSION,
  createCustomerBody,
  mergeCustomerBody,
  customerNoteBody,
  customerSearchText,
  searchTerms,
  updateCustomerBody,
  updateNoteBody,
  type CreateCustomerBody,
  type CustomerDetail,
  type CustomerListItem,
  type DuplicateMatch,
  type MergeCustomerBody,
  type UpdateCustomerBody,
} from '@estoicos/shared';
import type { z } from 'zod';
import { requireBranchAccess, requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps, RequestMeta } from '../../deps';
import { DomainError, Errors, isUniqueViolation } from '../../errors';
import { writeAudit } from '../audit/audit';

/**
 * Clientes: pertenecen a la MARCA (valen en todas las sucursales). Alta rápida en el local con
 * email obligatorio (decisión del 25/09/2026), búsqueda sin acentos y ficha con notas.
 */
function toListItem(c: Customer): CustomerListItem {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    dni: c.dni,
    lastVisitAt: c.lastVisitAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function searchCustomers(
  deps: CoreDeps,
  p: StaffPrincipal,
  query: { q: string; limit: number },
): Promise<CustomerListItem[]> {
  requirePermission(p, 'customers:read');
  const terms = searchTerms(query.q);
  const rows = await deps.db.customer.findMany({
    where: {
      organizationId: p.organizationId,
      anonymizedAt: null,
      mergedIntoId: null,
      AND: terms.map((t) => ({ searchText: { contains: t } })),
    },
    orderBy: terms.length ? [{ lastName: 'asc' }, { firstName: 'asc' }] : [{ createdAt: 'desc' }],
    take: query.limit,
  });
  return rows.map(toListItem);
}

/** Posibles duplicados: mismo email o DNI (bloquean) y mismo celular (se puede confirmar). */
async function findDuplicates(
  db: Tx | CoreDeps['db'],
  organizationId: string,
  data: { email?: string | null; dni?: string | null; phone?: string | null },
  exceptId?: string,
): Promise<DuplicateMatch[]> {
  const or: Prisma.CustomerWhereInput[] = [];
  if (data.email) or.push({ email: data.email });
  if (data.dni) or.push({ dni: data.dni });
  if (data.phone) or.push({ phone: data.phone });
  if (!or.length) return [];
  const rows = await db.customer.findMany({
    where: {
      organizationId,
      anonymizedAt: null,
      mergedIntoId: null,
      OR: or,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    take: 5,
  });
  return rows.map((c) => ({
    id: c.id,
    name: `${c.firstName} ${c.lastName}`.trim(),
    phone: c.phone,
    email: c.email,
    reason: data.email && c.email === data.email ? 'EMAIL' : data.dni && c.dni === data.dni ? 'DNI' : 'PHONE',
  }));
}

function duplicateError(matches: DuplicateMatch[]): DomainError {
  const hard = matches.find((m) => m.reason !== 'PHONE');
  if (hard) {
    return new DomainError(
      'DUPLICATE_CUSTOMER',
      hard.reason === 'EMAIL'
        ? `Ya hay un cliente con ese email: ${hard.name}.`
        : `Ya hay un cliente con ese DNI: ${hard.name}.`,
      409,
      { matches },
    );
  }
  return new DomainError(
    'POSSIBLE_DUPLICATE',
    `Ya hay ${matches.length === 1 ? 'un cliente' : 'clientes'} con ese celular: ${matches.map((m) => m.name).join(', ')}. ¿Es otra persona?`,
    409,
    { matches },
  );
}

async function recordConsents(
  tx: Tx,
  input: {
    customerId: string;
    transactional: boolean;
    marketing: boolean;
    source: ConsentSource;
    p: StaffPrincipal;
    meta: RequestMeta;
  },
) {
  const current = await tx.customerConsent.findMany({ where: { customerId: input.customerId } });
  for (const channel of ['EMAIL', 'WHATSAPP'] as const) {
    for (const [scope, granted] of [
      ['TRANSACTIONAL', input.transactional],
      ['MARKETING', input.marketing],
    ] as const) {
      if (current.find((c) => c.channel === channel && c.scope === scope)?.granted === granted) continue;
      await tx.customerConsent.upsert({
        where: { customerId_channel_scope: { customerId: input.customerId, channel, scope } },
        create: { customerId: input.customerId, channel, scope, granted },
        update: { granted },
      });
      await tx.consentEvent.create({
        data: {
          customerId: input.customerId,
          channel,
          scope,
          granted,
          source: input.source,
          policyVersion: CONSENT_POLICY_VERSION,
          recordedById: input.p.userId,
          ipAddress: input.meta.ip ?? null,
          userAgent: input.meta.userAgent?.slice(0, 400) ?? null,
        },
      });
    }
  }
}

/** Alta rápida en el local: una pantalla, consentimientos registrados con fecha y quién los cargó. */
export async function createCustomer(
  deps: CoreDeps,
  p: StaffPrincipal,
  rawBody: CreateCustomerBody,
  meta: RequestMeta,
): Promise<CustomerDetail> {
  requirePermission(p, 'customers:create');
  const body = createCustomerBody.parse(rawBody);
  if (body.homeBranchId) requireBranchAccess(p, body.homeBranchId);

  const duplicates = await findDuplicates(deps.db, p.organizationId, body);
  const blocking = duplicates.filter((d) => d.reason !== 'PHONE' || !body.allowSamePhone);
  if (blocking.length) throw duplicateError(blocking);

  try {
    const id = await deps.db.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          organizationId: p.organizationId,
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email,
          phone: body.phone,
          dni: body.dni,
          preferredChannel: body.preferredChannel,
          source: 'IN_STORE',
          homeBranchId: body.homeBranchId ?? p.branchIds[0] ?? null,
          createdById: p.userId,
          searchText: customerSearchText(body),
        },
      });
      await recordConsents(tx, {
        customerId: customer.id,
        transactional: body.acceptTransactional,
        marketing: body.acceptMarketing,
        source: 'IN_STORE',
        p,
        meta,
      });
      return customer.id;
    });
    return getCustomerDetail(deps, p, id);
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateError(await findDuplicates(deps.db, p.organizationId, body));
    throw error;
  }
}

export async function getCustomerDetail(
  deps: CoreDeps,
  p: StaffPrincipal,
  customerId: string,
): Promise<CustomerDetail> {
  requirePermission(p, 'customers:read');
  const c = await deps.db.customer.findFirst({
    where: { id: customerId, organizationId: p.organizationId, anonymizedAt: null, mergedIntoId: null },
    include: {
      consents: true,
      consentEvents: { orderBy: { occurredAt: 'desc' }, take: 20 },
      notes: {
        where: { deletedAt: null },
        include: { author: { select: { name: true } } },
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      },
    },
  });
  if (!c) throw Errors.notFound('No encontramos ese cliente.');
  const [appointments, noShows, history, sales] = await Promise.all([
    deps.db.appointment.count({ where: { customerId } }),
    deps.db.appointment.count({ where: { customerId, status: 'NO_SHOW' } }),
    deps.db.appointment.findMany({
      where: { customerId },
      include: {
        branch: { select: { name: true } },
        barber: { select: { displayName: true } },
        services: { include: { service: { select: { name: true } } }, orderBy: { position: 'asc' } },
      },
      orderBy: { startsAt: 'desc' },
      take: 30,
    }),
    deps.db.sale.findMany({
      where: { customerId, status: { in: ['PAID', 'VOIDED'] } },
      include: {
        items: { select: { description: true, quantity: true } },
        payments: { select: { method: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);
  return {
    ...toListItem(c),
    preferredChannel: c.preferredChannel,
    emailVerifiedAt: c.emailVerifiedAt?.toISOString() ?? null,
    source: c.source,
    homeBranchId: c.homeBranchId,
    consents: {
      transactional: c.consents.some((x) => x.scope === 'TRANSACTIONAL' && x.granted),
      marketing: c.consents.some((x) => x.scope === 'MARKETING' && x.granted),
    },
    consentHistory: c.consentEvents.map((e) => ({
      channel: e.channel,
      scope: e.scope,
      granted: e.granted,
      source: e.source,
      occurredAt: e.occurredAt.toISOString(),
    })),
    notes: c.notes.map((n) => ({
      id: n.id,
      body: n.body,
      pinned: n.pinned,
      authorName: n.author.name,
      createdAt: n.createdAt.toISOString(),
    })),
    stats: { appointments, noShows },
    appointments: history.map((a) => ({
      id: a.id,
      startsAt: a.startsAt.toISOString(),
      status: a.status,
      branchName: a.branch.name,
      barberName: a.barber.displayName,
      services: a.services.map((s) => s.service.name),
      totalCents: Number(a.bookedTotalCents),
    })),
    sales: sales.map((x) => ({
      id: x.id,
      number: x.number,
      status: x.status,
      date: (x.paidAt ?? x.createdAt).toISOString(),
      summary: x.items
        .map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.description}` : i.description))
        .join(', '),
      totalCents: Number(x.totalCents),
      methods: [...new Set(x.payments.map((m) => m.method))],
    })),
  };
}

export async function updateCustomer(
  deps: CoreDeps,
  p: StaffPrincipal,
  customerId: string,
  rawBody: UpdateCustomerBody,
  meta: RequestMeta,
): Promise<CustomerDetail> {
  requirePermission(p, 'customers:update');
  const body = updateCustomerBody.parse(rawBody);
  if (body.homeBranchId) requireBranchAccess(p, body.homeBranchId);
  const current = await deps.db.customer.findFirst({
    where: { id: customerId, organizationId: p.organizationId, anonymizedAt: null, mergedIntoId: null },
    include: { consents: true },
  });
  if (!current) throw Errors.notFound('No encontramos ese cliente.');

  const hard = (
    await findDuplicates(deps.db, p.organizationId, { email: body.email, dni: body.dni }, customerId)
  ).filter((d) => d.reason !== 'PHONE');
  if (hard.length) throw duplicateError(hard);

  const { acceptTransactional, acceptMarketing, ...fields } = body;
  const merged = { ...current, ...fields };
  try {
    await deps.db.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customerId },
        data: {
          ...fields,
          // Un email nuevo tiene que volver a verificarse al ingresar al portal.
          ...(fields.email && fields.email !== current.email
            ? { emailVerifiedAt: null, emailBouncedAt: null }
            : {}),
          ...(fields.phone && fields.phone !== current.phone
            ? { whatsappUnreachableAt: null, whatsappUserId: null }
            : {}),
          searchText: customerSearchText(merged),
        },
      });
      if (acceptTransactional !== undefined || acceptMarketing !== undefined) {
        const has = (scope: 'TRANSACTIONAL' | 'MARKETING') =>
          current.consents.some((c) => c.scope === scope && c.granted);
        await recordConsents(tx, {
          customerId,
          transactional: acceptTransactional ?? has('TRANSACTIONAL'),
          marketing: acceptMarketing ?? has('MARKETING'),
          source: 'STAFF_UPDATE',
          p,
          meta,
        });
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw Errors.conflict('Ya hay otro cliente con ese email o DNI.');
    throw error;
  }
  return getCustomerDetail(deps, p, customerId);
}

// ---------------------------------------------------------------------------
// Notas del staff sobre el cliente
// ---------------------------------------------------------------------------

async function assertCustomer(deps: CoreDeps, p: StaffPrincipal, customerId: string) {
  const found = await deps.db.customer.findFirst({
    where: { id: customerId, organizationId: p.organizationId, anonymizedAt: null, mergedIntoId: null },
    select: { id: true },
  });
  if (!found) throw Errors.notFound('No encontramos ese cliente.');
}

export async function addCustomerNote(
  deps: CoreDeps,
  p: StaffPrincipal,
  customerId: string,
  rawBody: z.input<typeof customerNoteBody>,
): Promise<CustomerDetail> {
  requirePermission(p, 'customers:update');
  await assertCustomer(deps, p, customerId);
  const body = customerNoteBody.parse(rawBody);
  await deps.db.customerNote.create({
    data: {
      customerId,
      authorId: p.userId,
      branchId: p.branchIds[0] ?? null,
      body: body.body,
      pinned: body.pinned,
    },
  });
  return getCustomerDetail(deps, p, customerId);
}

export async function updateCustomerNote(
  deps: CoreDeps,
  p: StaffPrincipal,
  customerId: string,
  noteId: string,
  rawBody: z.input<typeof updateNoteBody>,
): Promise<CustomerDetail> {
  requirePermission(p, 'customers:update');
  await assertCustomer(deps, p, customerId);
  const body = updateNoteBody.parse(rawBody);
  const result = await deps.db.customerNote.updateMany({
    where: { id: noteId, customerId, deletedAt: null },
    data: { pinned: body.pinned },
  });
  if (result.count === 0) throw Errors.notFound('No encontramos esa nota.');
  return getCustomerDetail(deps, p, customerId);
}

/** Las notas se ocultan (no se borran físicamente) para mantener el historial. */
export async function deleteCustomerNote(
  deps: CoreDeps,
  p: StaffPrincipal,
  customerId: string,
  noteId: string,
) {
  requirePermission(p, 'customers:update');
  await assertCustomer(deps, p, customerId);
  const result = await deps.db.customerNote.updateMany({
    where: { id: noteId, customerId, deletedAt: null },
    data: { deletedAt: deps.now() },
  });
  if (result.count === 0) throw Errors.notFound('No encontramos esa nota.');
  return getCustomerDetail(deps, p, customerId);
}

// ---------------------------------------------------------------------------
// Fusión de duplicados
// ---------------------------------------------------------------------------

/**
 * Fusiona un registro repetido en el cliente que se conserva: pasan turnos, notas, ventas,
 * cobros y notificaciones; se completan los datos que le falten (email, celular, DNI) y los
 * consentimientos que no tenga. El duplicado queda sin datos personales, apuntando al que se
 * conservó (las tablas inmutables, como el historial de consentimientos, siguen apuntándolo).
 */
export async function mergeCustomers(
  deps: CoreDeps,
  p: StaffPrincipal,
  keepId: string,
  rawBody: MergeCustomerBody,
  meta: RequestMeta,
): Promise<CustomerDetail> {
  requirePermission(p, 'customers:merge');
  const { duplicateId } = mergeCustomerBody.parse(rawBody);
  if (duplicateId === keepId) throw Errors.invalid('Elegí otro cliente: es el mismo registro.');

  await deps.db.$transaction(async (tx) => {
    for (const id of [keepId, duplicateId].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`customer:${id}`}, 0))`;
    }
    const [keep, dup] = await Promise.all(
      [keepId, duplicateId].map((id) =>
        tx.customer.findFirst({
          where: { id, organizationId: p.organizationId, anonymizedAt: null, mergedIntoId: null },
          include: { consents: true },
        }),
      ),
    );
    if (!keep || !dup) throw Errors.notFound('No encontramos alguno de los dos clientes.');

    // Puntos y saldo a favor son registros inmutables: su traspaso llega con esas fases.
    const [points, credit] = await Promise.all([
      tx.pointsEntry.count({ where: { customerId: duplicateId } }),
      tx.customerCreditEntry.count({ where: { customerId: duplicateId } }),
    ]);
    if (points || credit) {
      throw Errors.conflict(
        'El registro repetido tiene puntos o saldo a favor: todavía no se puede fusionar.',
      );
    }

    const where = { customerId: duplicateId };
    const data = { customerId: keepId };
    const moved = {
      appointments: (await tx.appointment.updateMany({ where, data })).count,
      notes: (await tx.customerNote.updateMany({ where, data })).count,
      sales: (await tx.sale.updateMany({ where, data })).count,
      payments: (await tx.payment.updateMany({ where, data })).count,
      notifications: (await tx.notification.updateMany({ where, data })).count,
    };
    await tx.rewardRedemption.updateMany({ where, data });
    await tx.session.updateMany({ where: { ...where, revokedAt: null }, data: { revokedAt: deps.now() } });

    for (const c of dup.consents) {
      if (!keep.consents.some((k) => k.channel === c.channel && k.scope === c.scope)) {
        await tx.customerConsent.create({
          data: { customerId: keepId, channel: c.channel, scope: c.scope, granted: c.granted },
        });
      }
    }

    // Datos que le faltan al que se conserva. Los únicos (email, DNI, WhatsApp) se liberan primero.
    const fill = {
      email: keep.email ?? dup.email,
      emailVerifiedAt: keep.email ? keep.emailVerifiedAt : dup.emailVerifiedAt,
      phone: keep.phone ?? dup.phone,
      dni: keep.dni ?? dup.dni,
      whatsappUserId: keep.whatsappUserId ?? dup.whatsappUserId,
      birthDate: keep.birthDate ?? dup.birthDate,
      homeBranchId: keep.homeBranchId ?? dup.homeBranchId,
      firstName: keep.firstName || dup.firstName,
      lastName: keep.lastName || dup.lastName,
      firstVisitAt: minDate(keep.firstVisitAt, dup.firstVisitAt),
      lastVisitAt: maxDate(keep.lastVisitAt, dup.lastVisitAt),
    };
    await tx.customer.update({
      where: { id: duplicateId },
      data: {
        firstName: 'Registro fusionado',
        lastName: '',
        email: null,
        phone: null,
        dni: null,
        whatsappUserId: null,
        birthDate: null,
        searchText: '',
        mergedIntoId: keepId,
        mergedAt: deps.now(),
      },
    });
    await tx.customer.update({
      where: { id: keepId },
      data: { ...fill, searchText: customerSearchText(fill) },
    });

    await writeAudit(tx, {
      organizationId: p.organizationId,
      actor: { type: 'STAFF', userId: p.userId },
      action: 'CUSTOMER_MERGED',
      entityType: 'Customer',
      entityId: keepId,
      summary: `Se fusionó ${`${dup.firstName} ${dup.lastName}`.trim() || dup.email || 'un registro'} en ${`${keep.firstName} ${keep.lastName}`.trim()}`,
      before: {
        duplicateId,
        duplicate: {
          name: `${dup.firstName} ${dup.lastName}`.trim(),
          email: dup.email,
          phone: dup.phone,
          dni: dup.dni,
        },
      },
      after: moved,
      meta,
    });
  });
  return getCustomerDetail(deps, p, keepId);
}

function minDate(a: Date | null, b: Date | null) {
  return a && b ? (a < b ? a : b) : (a ?? b);
}
function maxDate(a: Date | null, b: Date | null) {
  return a && b ? (a > b ? a : b) : (a ?? b);
}
