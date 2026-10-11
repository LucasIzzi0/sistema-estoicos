import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Cuando todavía no hay nada. Un vacío explicado (qué es esto, qué hacer) rinde mucho más que
 * un "Sin datos": es la primera pantalla que ve alguien que recién arranca.
 */
export function EmptyState(props: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  const Icon = props.icon;
  return (
    <div
      className={cn(
        'grid justify-items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center',
        props.className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <div className="grid gap-1">
        <p className="font-heading text-base font-semibold">{props.title}</p>
        {props.description && (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{props.description}</p>
        )}
      </div>
      {props.action}
    </div>
  );
}
