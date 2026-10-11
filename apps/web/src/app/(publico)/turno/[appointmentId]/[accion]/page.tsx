import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Wordmark } from '@/components/brand';
import { AppointmentAction } from './appointment-action';

export const metadata: Metadata = { title: 'Tu turno' };

type Props = {
  params: Promise<{ appointmentId: string; accion: string }>;
  searchParams: Promise<{ t?: string }>;
};

/**
 * Confirmar o cancelar el turno desde el recordatorio, **sin iniciar sesión**: el link lleva un
 * token firmado que solo sirve para ese turno y esa acción.
 */
export default async function AppointmentActionPage({ params, searchParams }: Props) {
  const { appointmentId, accion } = await params;
  const { t } = await searchParams;
  if (accion !== 'confirmar' && accion !== 'cancelar') notFound();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-4 py-5">
        <Wordmark />
      </header>
      <main className="mx-auto grid w-full max-w-md flex-1 content-start gap-6 px-4 pt-8">
        <AppointmentAction
          appointmentId={appointmentId}
          action={accion === 'confirmar' ? 'confirm' : 'cancel'}
          token={t ?? ''}
        />
      </main>
    </div>
  );
}
