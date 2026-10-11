import type { PublicBranch } from '@estoicos/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Wordmark } from '@/components/brand';
import { getCustomerMe, serverApi } from '@/lib/api/server';
import { BookingFlow } from './booking-flow';

type Props = { params: Promise<{ sucursal: string }> };

async function loadBranch(slug: string) {
  const { status, data } = await serverApi<PublicBranch>(`/v1/public/branches/${encodeURIComponent(slug)}`);
  if (status === 404 || !data) notFound();
  return data;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const branch = await loadBranch((await params).sucursal);
  return { title: `Reservar turno · ${branch.name}` };
}

/** Página pública de reservas por sucursal: se ven los horarios sin loguearse. */
export default async function PublicBookingPage({ params }: Props) {
  const branch = await loadBranch((await params).sucursal);
  const me = await getCustomerMe();

  return (
    <div className="dark flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-gold/20 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
          <Wordmark />
          <Link
            href={me ? '/mi-cuenta/turnos' : `/ingresar?next=/reservar/${branch.slug}`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            {me ? 'Mis turnos' : 'Ingresar'}
          </Link>
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-md flex-1 content-start gap-6 px-4 pb-16 pt-6">
        <div className="grid gap-2">
          <h1 className="text-3xl font-extrabold uppercase leading-none text-gold sm:text-4xl">
            Reservá
            <br />
            tu turno
          </h1>
          <div className="grid gap-0.5 text-sm">
            <span className="font-medium text-foreground">{branch.name}</span>
            {branch.address && (
              <span className="text-muted-foreground">
                {[branch.address, branch.city].filter(Boolean).join(', ')}
              </span>
            )}
          </div>
        </div>
        {branch.bookingEnabled ? (
          <BookingFlow branch={branch} me={me} />
        ) : (
          <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
            Esta sucursal no está tomando reservas online por ahora. Escribinos o acercate al local.
          </p>
        )}
      </main>
    </div>
  );
}
