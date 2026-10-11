import type { Customer } from '@estoicos/db';
import {
  CONSENT_POLICY_VERSION,
  CUSTOMER_AUTH,
  customerProfileBody,
  customerSearchText,
  type CustomerMe,
  type CustomerProfileBody,
} from '@estoicos/shared';
import type { CoreDeps, RequestMeta } from '../../deps';
import { Errors, isUniqueViolation } from '../../errors';
import { sendAuthEmail } from '../notifications/auth-emails';
import { loginCodeEmail } from '../notifications/templates';
import type { OrganizationRef } from '../organization/organization';
import { countRecentCodes, issueNumericCode, verifyNumericCode } from './codes';
import { createSession } from './sessions';

/**
 * Paso 1 del acceso de clientes: enviar un código por email.
 * La respuesta es la misma exista o no el cliente (no revela quién es cliente).
 */
export async function requestCustomerCode(
  deps: CoreDeps,
  input: { organization: OrganizationRef; email: string; meta: RequestMeta },
): Promise<void> {
  const { organization, email } = input;
  const base = { purpose: 'CUSTOMER_LOGIN' as const, organizationId: organization.id, email };

  if (
    (await countRecentCodes(deps, { ...base, sinceMinutes: 15 })) >= CUSTOMER_AUTH.maxCodesPerEmailPer15Min
  ) {
    throw Errors.tooManyRequests('Pediste varios códigos seguidos. Esperá unos minutos y probá de nuevo.');
  }
  if (
    (await countRecentCodes(deps, { ...base, sinceMinutes: 24 * 60 })) >= CUSTOMER_AUTH.maxCodesPerEmailPerDay
  ) {
    throw Errors.tooManyRequests('Pediste demasiados códigos hoy. Probá de nuevo mañana.');
  }

  const customer = await deps.db.customer.findUnique({
    where: { organizationId_email: { organizationId: organization.id, email } },
    select: { id: true, anonymizedAt: true },
  });

  const { authCodeId, code } = await issueNumericCode(deps, {
    ...base,
    customerId: customer && !customer.anonymizedAt ? customer.id : undefined,
    ttlMinutes: CUSTOMER_AUTH.codeTtlMinutes,
    maxAttempts: CUSTOMER_AUTH.maxAttempts,
    meta: input.meta,
  });

  await sendAuthEmail(deps, {
    organizationId: organization.id,
    type: 'LOGIN_CODE',
    to: email,
    customerId: customer?.id,
    dedupeKey: `login-code:${authCodeId}`,
    email: loginCodeEmail({ orgName: organization.name, code, minutes: CUSTOMER_AUTH.codeTtlMinutes }),
    logPayload: { authCodeId },
  });
}

/**
 * Paso 2: validar el código. Si el email no era cliente, se crea el cliente (con perfil
 * pendiente). Devuelve el token de sesión (30 días).
 */
export async function verifyCustomerCode(
  deps: CoreDeps,
  input: { organization: OrganizationRef; email: string; code: string; meta: RequestMeta },
): Promise<{ token: string; customer: CustomerMe; isNew: boolean }> {
  const { organization, email } = input;
  await verifyNumericCode(deps, {
    purpose: 'CUSTOMER_LOGIN',
    organizationId: organization.id,
    email,
    code: input.code,
  });

  const now = deps.now();
  let customer = await deps.db.customer.findUnique({
    where: { organizationId_email: { organizationId: organization.id, email } },
  });
  let isNew = false;

  if (customer?.anonymizedAt) customer = null;
  if (!customer) {
    try {
      customer = await deps.db.customer.create({
        data: {
          organizationId: organization.id,
          email,
          emailVerifiedAt: now,
          firstName: '',
          lastName: '',
          source: 'ONLINE_BOOKING',
          searchText: customerSearchText({ firstName: '', lastName: '', email }),
        },
      });
      isNew = true;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      customer = await deps.db.customer.findUniqueOrThrow({
        where: { organizationId_email: { organizationId: organization.id, email } },
      });
    }
  } else if (!customer.emailVerifiedAt) {
    customer = await deps.db.customer.update({ where: { id: customer.id }, data: { emailVerifiedAt: now } });
  }

  const { token } = await createSession(deps.db, {
    kind: 'CUSTOMER',
    organizationId: organization.id,
    customerId: customer.id,
    ttlDays: CUSTOMER_AUTH.sessionDays,
    meta: input.meta,
    now,
  });
  return { token, customer: await getCustomerMe(deps, customer.id), isNew };
}

export async function getCustomerMe(deps: CoreDeps, customerId: string): Promise<CustomerMe> {
  const customer = await deps.db.customer.findUniqueOrThrow({
    where: { id: customerId },
    include: { consents: true },
  });
  return toCustomerMe(customer, customer.consents);
}

function toCustomerMe(
  customer: Customer,
  consents: { scope: 'TRANSACTIONAL' | 'MARKETING'; granted: boolean }[],
): CustomerMe {
  return {
    id: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone,
    preferredChannel: customer.preferredChannel,
    consents: {
      transactional: consents.some((c) => c.scope === 'TRANSACTIONAL' && c.granted),
      marketing: consents.some((c) => c.scope === 'MARKETING' && c.granted),
    },
    needsProfile: !customer.firstName || !customer.lastName || !customer.phone,
  };
}

/**
 * El cliente completa o actualiza su perfil y sus consentimientos. Cada cambio de
 * consentimiento queda en el historial inmutable con fecha, IP y versión del texto.
 */
export async function updateCustomerProfile(
  deps: CoreDeps,
  input: {
    customerId: string;
    body: CustomerProfileBody;
    source: 'BOOKING_PAGE' | 'CUSTOMER_PORTAL';
    meta: RequestMeta;
  },
): Promise<CustomerMe> {
  const body = customerProfileBody.parse(input.body);
  await deps.db.$transaction(async (tx) => {
    const current = await tx.customer.findUniqueOrThrow({
      where: { id: input.customerId },
      include: { consents: true },
    });
    await tx.customer.update({
      where: { id: current.id },
      data: {
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone,
        preferredChannel: body.preferredChannel,
        searchText: customerSearchText({ ...body, email: current.email, dni: current.dni }),
        // Si cambia el teléfono, se vuelve a intentar WhatsApp.
        ...(current.phone !== body.phone ? { whatsappUnreachableAt: null, whatsappUserId: null } : {}),
      },
    });

    const wanted = [
      { scope: 'TRANSACTIONAL' as const, granted: body.acceptTransactional },
      { scope: 'MARKETING' as const, granted: body.acceptMarketing },
    ];
    for (const channel of ['EMAIL', 'WHATSAPP'] as const) {
      for (const { scope, granted } of wanted) {
        const existing = current.consents.find((c) => c.channel === channel && c.scope === scope);
        if (existing?.granted === granted) continue;
        await tx.customerConsent.upsert({
          where: { customerId_channel_scope: { customerId: current.id, channel, scope } },
          create: { customerId: current.id, channel, scope, granted },
          update: { granted },
        });
        await tx.consentEvent.create({
          data: {
            customerId: current.id,
            channel,
            scope,
            granted,
            source: input.source,
            policyVersion: CONSENT_POLICY_VERSION,
            ipAddress: input.meta.ip ?? null,
            userAgent: input.meta.userAgent?.slice(0, 400) ?? null,
          },
        });
      }
    }
  });
  return getCustomerMe(deps, input.customerId);
}
