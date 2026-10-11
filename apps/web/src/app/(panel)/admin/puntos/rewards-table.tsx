'use client';

import { REWARD_TYPE_LABELS, type RewardDto } from '@estoicos/shared';
import { Gift, MoreHorizontal } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, ApiClientError } from '@/lib/api/client';
import { formatBps, formatCents } from '@/lib/format';
import { RewardDialog, type CatalogOption } from './reward-dialog';

/** Catálogo de recompensas: lo que el cliente puede pedir con sus puntos. */
export function RewardsTable(props: {
  initial: RewardDto[];
  services: CatalogOption[];
  products: CatalogOption[];
  canManage: boolean;
}) {
  const [rewards, setRewards] = useState(props.initial);
  const [editing, setEditing] = useState<RewardDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();

  function archive(reward: RewardDto) {
    startTransition(async () => {
      try {
        setRewards(await api<RewardDto[]>(`/v1/rewards/${reward.id}/archive`, { body: {} }));
        toast.success(reward.archived ? `"${reward.name}" recuperada.` : `"${reward.name}" archivada.`);
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo actualizar.');
      }
    });
  }

  function detail(r: RewardDto) {
    if (r.type === 'FREE_SERVICE') return r.serviceName ?? 'Servicio borrado';
    if (r.type === 'FREE_PRODUCT') return r.productName ?? 'Producto borrado';
    if (r.type === 'FIXED_DISCOUNT') return formatCents(r.discountFixedCents ?? 0);
    return formatBps(r.discountPercentBps ?? 0);
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1.5">
          <CardTitle className="text-lg">Recompensas</CardTitle>
          <CardDescription>
            Lo que el cliente canjea en el mostrador. Se aplican sobre una línea de la venta.
          </CardDescription>
        </div>
        {props.canManage && (
          <RewardDialog
            services={props.services}
            products={props.products}
            open={creating}
            onOpenChange={setCreating}
            onSaved={setRewards}
          />
        )}
      </CardHeader>
      <CardContent>
        {rewards.length === 0 ? (
          <EmptyState
            icon={Gift}
            title="Todavía no hay recompensas"
            description="Cargá lo que el cliente puede pedir con sus puntos: un corte gratis, un descuento, un producto."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recompensa</TableHead>
                  <TableHead>Qué da</TableHead>
                  <TableHead className="text-right">Puntos</TableHead>
                  <TableHead className="text-right">Canjes</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rewards.map((r) => (
                  <TableRow key={r.id} className={r.active && !r.archived ? undefined : 'opacity-60'}>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      <div className="flex flex-wrap items-center gap-1 pt-1 text-xs text-muted-foreground">
                        {REWARD_TYPE_LABELS[r.type]}
                        {r.archived && <Badge variant="outline">Archivada</Badge>}
                        {!r.archived && !r.active && <Badge variant="outline">Inactiva</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{detail(r)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{r.pointsCost}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.redemptions}
                    </TableCell>
                    <TableCell>
                      {props.canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={pending}
                              aria-label={`Acciones para ${r.name}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {!r.archived && (
                              <DropdownMenuItem onSelect={() => setEditing(r)}>Editar</DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              variant={r.archived ? 'default' : 'destructive'}
                              onSelect={() => archive(r)}
                            >
                              {r.archived ? 'Recuperar' : 'Archivar'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {editing && (
        <RewardDialog
          key={editing.id}
          reward={editing}
          services={props.services}
          products={props.products}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={setRewards}
        />
      )}
    </Card>
  );
}
