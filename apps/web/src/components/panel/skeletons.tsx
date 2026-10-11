import { Skeleton } from '@/components/ui/skeleton';

/**
 * Esqueletos de carga. Mientras el servidor trae los números, la pantalla ya muestra su forma:
 * se siente rápida y no pega un salto cuando llegan los datos.
 */
export function PageSkeleton({
  stats = 0,
  blocks = 2,
}: {
  /** Cuántas tarjetas de números tiene la pantalla. */
  stats?: number;
  blocks?: number;
}) {
  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <div className="grid gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      {stats > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: stats }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: blocks }, (_, i) => (
          <Skeleton key={i} className="h-56 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/** Lista o tabla que todavía está cargando. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <div className="grid gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid gap-2 rounded-xl border p-4">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    </div>
  );
}
