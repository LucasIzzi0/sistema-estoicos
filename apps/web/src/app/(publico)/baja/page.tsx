import type { Metadata } from 'next';
import { Wordmark } from '@/components/brand';
import { Unsubscribe } from './unsubscribe';

export const metadata: Metadata = { title: 'No recibir promociones' };

type Props = { searchParams: Promise<{ c?: string; t?: string }> };

/** Baja de los mensajes de promoción, desde el link del email. No necesita iniciar sesión. */
export default async function UnsubscribePage({ searchParams }: Props) {
  const { c, t } = await searchParams;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-4 py-5">
        <Wordmark />
      </header>
      <main className="mx-auto grid w-full max-w-md flex-1 content-start gap-6 px-4 pt-8">
        <Unsubscribe customerId={c ?? ''} token={t ?? ''} />
      </main>
    </div>
  );
}
