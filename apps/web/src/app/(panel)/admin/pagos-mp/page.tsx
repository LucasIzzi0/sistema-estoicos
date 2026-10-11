import type { MpAccountDto, MpInboxItem, MpTerminalDto } from '@estoicos/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageTitle } from '@/components/panel/coming-soon';
import { can } from '@/components/panel/nav';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { ConnectAccount } from './connect-account';
import { PaymentsInbox } from './payments-inbox';
import { TerminalsCard } from './terminals-card';

export const metadata: Metadata = { title: 'Pagos Mercado Pago' };

export default async function MercadoPagoPage() {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  if (!can(me, 'mercadopago:reconcile')) redirect('/admin');
  const canConnect = can(me, 'mercadopago:connect');

  const [{ data: accountData }, { data: terminals }, { data: inbox }] = await Promise.all([
    serverApi<{ account: MpAccountDto | null }>('/v1/mercadopago/account'),
    serverApi<MpTerminalDto[]>('/v1/mercadopago/terminals'),
    serverApi<MpInboxItem[]>('/v1/mercadopago/payments?status=UNASSIGNED'),
  ]);
  const account = accountData?.account ?? null;

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <PageTitle
        title="Pagos Mercado Pago"
        description="Cobro con el Point, señas online y control de que ningún pago quede sin registrar."
      />
      <ConnectAccount account={account} canConnect={canConnect} />
      {account && (
        <>
          <TerminalsCard
            terminals={terminals ?? []}
            branches={me.branches}
            canConnect={canConnect}
            accountStatus={account.status}
          />
          <PaymentsInbox initial={inbox ?? []} />
        </>
      )}
    </div>
  );
}
