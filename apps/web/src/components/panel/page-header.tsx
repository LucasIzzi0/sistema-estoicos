import { cn } from '@/lib/utils';

/** Encabezado de pantalla: título de cartel, una línea que explica y las acciones a la derecha. */
export function PageHeader(props: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-3', props.className)}>
      <div className="grid gap-1">
        <h1 className="text-2xl font-extrabold uppercase sm:text-3xl">{props.title}</h1>
        {props.description && (
          <p className="max-w-prose text-sm text-muted-foreground">{props.description}</p>
        )}
      </div>
      {props.actions && <div className="flex flex-wrap items-center gap-2">{props.actions}</div>}
    </div>
  );
}
