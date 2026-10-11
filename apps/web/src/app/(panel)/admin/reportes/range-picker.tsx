'use client';

import { addDays } from '@estoicos/shared';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Elegir el período. Los atajos cubren lo que se mira todos los días; el resto, a mano. */
export function RangePicker(props: {
  from: string;
  to: string;
  today: string;
  branchId: string;
  branches: { id: string; name: string }[];
  allBranches: boolean;
}) {
  const router = useRouter();
  const go = (from: string, to: string, branchId = props.branchId) =>
    router.push(
      `/admin/reportes?desde=${from}&hasta=${to}${branchId ? `&sucursal=${branchId}` : ''}`,
    );

  const monthStart = `${props.today.slice(0, 7)}-01`;
  const previousMonthEnd = addDays(monthStart, -1);
  const shortcuts: [string, string, string][] = [
    ['Hoy', props.today, props.today],
    ['Últimos 7 días', addDays(props.today, -6), props.today],
    ['Este mes', monthStart, props.today],
    ['Mes pasado', `${previousMonthEnd.slice(0, 7)}-01`, previousMonthEnd],
  ];

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {shortcuts.map(([label, from, to]) => (
          <Button
            key={label}
            size="sm"
            variant={props.from === from && props.to === to ? 'default' : 'outline'}
            onClick={() => go(from, to)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          aria-label="Desde"
          className="w-40"
          value={props.from}
          max={props.to}
          onChange={(e) => e.target.value && go(e.target.value, props.to)}
        />
        <span className="text-sm text-muted-foreground">a</span>
        <Input
          type="date"
          aria-label="Hasta"
          className="w-40"
          value={props.to}
          min={props.from}
          onChange={(e) => e.target.value && go(props.from, e.target.value)}
        />
        {props.branches.length > 1 && (
          <Select
            value={props.branchId || 'all'}
            onValueChange={(v) => go(props.from, props.to, v === 'all' ? '' : v)}
          >
            <SelectTrigger className="w-48" aria-label="Sucursal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{props.allBranches ? 'Toda la marca' : 'Mis sucursales'}</SelectItem>
              {props.branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
