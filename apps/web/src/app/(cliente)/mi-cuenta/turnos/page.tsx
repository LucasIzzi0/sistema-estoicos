import type { MyAppointments } from '@estoicos/shared';
import type { Metadata } from 'next';
import { serverApi } from '@/lib/api/server';
import { MyAppointmentsList } from './my-appointments';

export const metadata: Metadata = { title: 'Mis turnos' };

export default async function MyAppointmentsPage() {
  const { data } = await serverApi<MyAppointments>('/v1/me/appointments');
  return (
    <div className="grid gap-6">
      <h1 className="text-3xl font-extrabold uppercase text-gold">Mis turnos</h1>
      <MyAppointmentsList data={data ?? { upcoming: [], past: [] }} />
    </div>
  );
}
