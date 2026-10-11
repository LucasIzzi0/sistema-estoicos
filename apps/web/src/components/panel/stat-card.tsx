import { TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'default' | 'good' | 'bad' | 'warn';

const TONE: Record<Tone, { value: string; chip: string }> = {
  default: { value: 'text-foreground', chip: 'bg-muted text-muted-foreground' },
  good: { value: 'text-success', chip: 'bg-success/10 text-success' },
  bad: { value: 'text-destructive', chip: 'bg-destructive/10 text-destructive' },
  warn: { value: 'text-warning', chip: 'bg-warning/15 text-warning' },
};

/**
 * Tarjeta de un número: lo que se mira de reojo. El número manda, el resto acompaña.
 * Se usa igual en el dashboard y en los reportes, así los números se leen siempre parecido.
 */
export function StatCard(props: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
  icon?: LucideIcon;
  /** Variación respecto del período anterior, en porcentaje. */
  changePercent?: number | null;
  size?: 'md' | 'lg';
}) {
  const tone = TONE[props.tone ?? 'default'];
  const Icon = props.icon;
  const change = props.changePercent;

  return (
    <div className="group relative overflow-hidden rounded-xl border bg-card p-4 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-raised)]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {props.label}
        </span>
        {Icon && (
          <span className={cn('flex size-7 items-center justify-center rounded-lg', tone.chip)}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <div
        className={cn(
          'stat-value mt-2',
          props.size === 'lg' ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl',
          tone.value,
        )}
      >
        {props.value}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        {props.hint && <span className="text-xs text-muted-foreground">{props.hint}</span>}
        {change !== null && change !== undefined && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium',
              change >= 0 ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive',
            )}
          >
            {change >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
            {change > 0 ? '+' : ''}
            {change} %
          </span>
        )}
      </div>
    </div>
  );
}
