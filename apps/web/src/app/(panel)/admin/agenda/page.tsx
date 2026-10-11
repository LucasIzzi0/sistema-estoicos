import { todayIn, type Agenda, type ServiceDto } from '@estoicos/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can } from '@/components/panel/nav';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { currentBranch } from '@/lib/branch';
import { weekStart } from '@/lib/agenda';
import { AgendaBoard } from './agenda-board';

export const metadata: Metadata = { title: 'Agenda' };

type Props = { searchParams: Promise<{ fecha?: string; vista?: string; barbero?: string }> };

/** Agenda de la sucursal elegida: día (una columna por barbero) o semana (un barbero). */
export default async function AgendaPage({ searchParams }: Props) {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  if (!can(me, 'agenda:read')) redirect('/admin');
  const branch = await currentBranch(me);
  if (!branch) {
    return <p className="text-muted-foreground">No tenés sucursales asignadas.</p>;
  }

  const params = await searchParams;
  const timezone = 'America/Argentina/Buenos_Aires';
  const today = todayIn(timezone);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.fecha ?? '') ? params.fecha! : today;
  const view = params.vista === 'semana' ? 'week' : 'day';

  const dayAgenda = await serverApi<Agenda>(`/v1/branches/${branch.id}/agenda?date=${date}&days=1`);
  if (!dayAgenda.data) redirect('/admin');
  const barberId = params.barbero ?? dayAgenda.data.barbers[0]?.id;
  const initial =
    view === 'week' && barberId
      ? ((
          await serverApi<Agenda>(
            `/v1/branches/${branch.id}/agenda?date=${weekStart(date)}&days=7&barberId=${barberId}`,
          )
        ).data ?? dayAgenda.data)
      : dayAgenda.data;

  const { data: services } = await serverApi<ServiceDto[]>('/v1/services');
  const offered = (services ?? []).filter(
    (s) => s.active && !s.archived && s.branches.some((b) => b.branchId === branch.id && b.offered),
  );

  return (
    <AgendaBoard
      branchId={branch.id}
      branchName={branch.name}
      initial={initial}
      allBarbers={dayAgenda.data.barbers.map((b) => ({
        id: b.id,
        displayName: b.displayName,
        color: b.color,
      }))}
      initialDate={date}
      initialView={view}
      initialBarberId={barberId ?? null}
      today={today}
      services={offered.map((s) => ({
        id: s.id,
        name: s.name,
        durationMin: s.durationMin,
        priceCents: s.branches.find((b) => b.branchId === branch.id)?.priceCentsOverride ?? s.basePriceCents,
      }))}
      canManage={can(me, 'appointments:manage')}
      canCharge={can(me, 'sales:charge')}
    />
  );
}
