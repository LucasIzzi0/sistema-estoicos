import type { PublicBranchSummary } from '@estoicos/shared';
import { ChevronRight, MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { serverApi } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Reservar turno' };

/** Con una sola sucursal va directo a su página de reservas; con varias, se elige. */
export default async function ReserveFromPortal() {
  const { data: branches } = await serverApi<PublicBranchSummary[]>('/v1/public/branches');
  if (branches?.length === 1) redirect(`/reservar/${branches[0]!.slug}`);

  return (
    <div className="grid gap-6">
      <h1 className="text-3xl font-extrabold uppercase text-gold">Reservar turno</h1>
      {!branches?.length ? (
        <p className="rounded-xl border border-dashed px-6 py-12 text-center text-muted-foreground">
          Por ahora no hay sucursales tomando reservas online.
        </p>
      ) : (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">¿En qué sucursal?</p>
          {branches.map((b) => (
            <Link
              key={b.slug}
              href={`/reservar/${b.slug}`}
              className="flex items-center gap-3 rounded-lg border p-4 transition-colors hover:border-foreground/40"
            >
              <MapPin className="size-5 text-muted-foreground" />
              <span className="grid flex-1">
                <span className="font-medium">{b.name}</span>
                {(b.address || b.city) && (
                  <span className="text-sm text-muted-foreground">
                    {[b.address, b.city].filter(Boolean).join(', ')}
                  </span>
                )}
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
