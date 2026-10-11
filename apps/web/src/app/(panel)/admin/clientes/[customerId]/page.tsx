import {
  APPOINTMENT_STATUS_LABELS,
  type CustomerPoints,
  PAYMENT_METHOD_LABELS,
  SALE_STATUS_LABELS,
  type CustomerDetail,
  type PaymentMethod,
} from '@estoicos/shared';
import { ArrowLeft, Mail, Phone } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { can } from '@/components/panel/nav';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { formatCents, formatDate, formatDateTime, formatPhone } from '@/lib/format';
import { EditCustomerDialog } from './edit-customer-dialog';
import { CustomerNotes } from './customer-notes';
import { CustomerPointsCard } from './points-card';
import { MergeCustomerDialog } from './merge-customer-dialog';

export const metadata: Metadata = { title: 'Ficha del cliente' };

const SOURCE_LABEL = {
  IN_STORE: 'Alta en el local',
  ONLINE_BOOKING: 'Se registró online',
  IMPORT: 'Importado',
} as const;
const CONSENT_SOURCE_LABEL: Record<string, string> = {
  IN_STORE: 'en el local',
  BOOKING_PAGE: 'al reservar',
  CUSTOMER_PORTAL: 'desde su cuenta',
  STAFF_UPDATE: 'lo cambió el staff',
  WHATSAPP_REPLY: 'respondiendo por WhatsApp',
  EMAIL_LINK: 'desde un email',
  IMPORT: 'importación',
};

export default async function CustomerPage({ params }: { params: Promise<{ customerId: string }> }) {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  const { customerId } = await params;
  const [{ data: c }, { data: points }] = await Promise.all([
    serverApi<CustomerDetail>(`/v1/customers/${customerId}`),
    serverApi<CustomerPoints>(`/v1/customers/${customerId}/points`),
  ]);
  if (!c) notFound();
  const canUpdate = can(me, 'customers:update');

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <Link
        href="/admin/clientes"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Clientes
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-2">
          <h1 className="text-3xl font-extrabold uppercase">
            {c.firstName} {c.lastName}
          </h1>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            {c.phone && (
              <a
                href={`https://wa.me/${c.phone.replace('+', '')}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 hover:text-foreground"
              >
                <Phone className="size-4" />
                {formatPhone(c.phone)}
              </a>
            )}
            {c.email && (
              <span className="flex items-center gap-1.5">
                <Mail className="size-4" />
                {c.email}
                {c.emailVerifiedAt && <Badge variant="secondary">verificado</Badge>}
              </span>
            )}
            {c.dni && <span>DNI {c.dni}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can(me, 'customers:merge') && <MergeCustomerDialog customer={c} />}
          {canUpdate && <EditCustomerDialog customer={c} />}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Turnos', String(c.stats.appointments)],
          ['Ausencias', String(c.stats.noShows)],
          ['Última visita', c.lastVisitAt ? formatDate(c.lastVisitAt) : 'Nunca'],
          ['Cliente desde', formatDate(c.createdAt)],
        ].map(([label, value]) => (
          <div
            key={label}
            className={`rounded-lg border p-3 ${label === 'Ausencias' && c.stats.noShows > 0 ? 'border-destructive/50' : ''}`}
          >
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="font-heading text-xl font-bold">{value}</div>
          </div>
        ))}
      </div>

      <CustomerNotes customer={c} canUpdate={canUpdate} />

      {points && (
        <CustomerPointsCard
          customerId={c.id}
          initial={points}
          canAdjust={can(me, 'loyalty:adjust')}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Consentimientos</CardTitle>
          <CardDescription>
            {SOURCE_LABEL[c.source]}. Avisos por {c.preferredChannel === 'WHATSAPP' ? 'WhatsApp' : 'email'}.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant={c.consents.transactional ? 'default' : 'outline'}>
              Avisos de turnos: {c.consents.transactional ? 'sí' : 'no'}
            </Badge>
            <Badge variant={c.consents.marketing ? 'default' : 'outline'}>
              Promociones: {c.consents.marketing ? 'sí' : 'no'}
            </Badge>
          </div>
          {c.consentHistory.length > 0 && (
            <ul className="grid gap-1 text-xs text-muted-foreground">
              {c.consentHistory.map((e, i) => (
                <li key={i}>
                  {formatDateTime(e.occurredAt)} ·{' '}
                  {e.scope === 'TRANSACTIONAL' ? 'Avisos de turnos' : 'Promociones'} por{' '}
                  {e.channel === 'EMAIL' ? 'email' : 'WhatsApp'}: {e.granted ? 'aceptó' : 'no aceptó'} (
                  {CONSENT_SOURCE_LABEL[e.source] ?? e.source})
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Turnos</CardTitle>
          <CardDescription>
            Los últimos 30, en todas las sucursales. Los pagos se suman con la caja (Fase 4).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {c.appointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no tiene turnos.</p>
          ) : (
            <ul className="divide-y text-sm">
              {c.appointments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="grid">
                    <span className="font-medium">{formatDateTime(a.startsAt)}</span>
                    <span className="text-muted-foreground">
                      {a.services.join(' + ')} · {a.barberName} · {a.branchName}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums text-muted-foreground">{formatCents(a.totalCents)}</span>
                    <Badge variant={a.status === 'NO_SHOW' ? 'destructive' : 'outline'}>
                      {APPOINTMENT_STATUS_LABELS[a.status]}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pagos</CardTitle>
          <CardDescription>Últimas ventas cobradas (y anuladas).</CardDescription>
        </CardHeader>
        <CardContent>
          {c.sales.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no tiene ventas.</p>
          ) : (
            <ul className="divide-y text-sm">
              {c.sales.map((x) => (
                <li key={x.id}>
                  <Link
                    href={`/admin/caja/ventas/${x.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-muted/50"
                  >
                    <span className="grid">
                      <span className="font-medium">
                        #{x.number} · {formatDateTime(x.date)}
                      </span>
                      <span className="text-muted-foreground">{x.summary}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {x.methods.map((m) => PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m).join(' + ')}
                      </span>
                      <span className="tabular-nums">{formatCents(x.totalCents)}</span>
                      {x.status === 'VOIDED' && (
                        <Badge variant="destructive">{SALE_STATUS_LABELS.VOIDED}</Badge>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
