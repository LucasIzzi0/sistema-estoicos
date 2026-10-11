'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { formatCents, formatDuration } from '@/lib/format';
import type { AgendaService } from './types';

/** Servicios del turno (todos con el mismo barbero). El orden de marcado es el orden del turno. */
export function ServiceChecklist(props: {
  services: AgendaService[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const chosen = props.services.filter((s) => props.value.includes(s.id));
  return (
    <div className="grid gap-2">
      <div className="grid max-h-48 gap-1 overflow-y-auto rounded-md border p-2">
        {props.services.map((s) => {
          const on = props.value.includes(s.id);
          return (
            <label
              key={s.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
            >
              <Checkbox
                checked={on}
                onCheckedChange={(v) =>
                  props.onChange(
                    v === true ? [...props.value, s.id] : props.value.filter((id) => id !== s.id),
                  )
                }
              />
              <span className="flex-1">{s.name}</span>
              <span className="text-xs text-muted-foreground">{formatDuration(s.durationMin)}</span>
              <span className="w-20 text-right text-xs tabular-nums">{formatCents(s.priceCents)}</span>
            </label>
          );
        })}
      </div>
      {chosen.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Total: {formatDuration(chosen.reduce((a, s) => a + s.durationMin, 0))} ·{' '}
          {formatCents(chosen.reduce((a, s) => a + s.priceCents, 0))} (la duración puede variar según el
          barbero)
        </p>
      )}
    </div>
  );
}
