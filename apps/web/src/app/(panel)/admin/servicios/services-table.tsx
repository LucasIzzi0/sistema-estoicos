'use client';

import type { BranchSummary, Category, ServiceDto } from '@estoicos/shared';
import { MoreHorizontal, Scissors } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { BranchPriceDialog } from '@/components/catalog/branch-price-dialog';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, ApiClientError } from '@/lib/api/client';
import { formatBps, formatCents, formatDuration } from '@/lib/format';
import { ServiceDialog } from './service-dialog';

export function ServicesTable(props: {
  services: ServiceDto[];
  categories: Category[];
  branch: BranchSummary | null;
  canManage: boolean;
  canBranchPrices: boolean;
  showArchived: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ServiceDto | null>(null);
  const [pricing, setPricing] = useState<ServiceDto | null>(null);
  const [pending, startTransition] = useTransition();

  const groups = new Map<string, ServiceDto[]>();
  for (const s of props.services) {
    const key = s.categoryName ?? 'Sin categoría';
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  function setArchived(service: ServiceDto, archived: boolean) {
    startTransition(async () => {
      try {
        await api(`/v1/services/${service.id}`, { method: 'PATCH', body: { archived } });
        toast.success(archived ? `"${service.name}" archivado.` : `"${service.name}" recuperado.`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo actualizar.');
      }
    });
  }

  if (props.services.length === 0) {
    return (
      <EmptyState
        icon={Scissors}
        title="Todavía no hay servicios"
        description="Cargá el corte, la barba y los combos: son los que se eligen al reservar y al cobrar."
      />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Servicio</TableHead>
              <TableHead>Duración</TableHead>
              <TableHead className="text-right">Precio base</TableHead>
              {props.branch && <TableHead className="text-right">En {props.branch.name}</TableHead>}
              <TableHead>Seña</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...groups.entries()].map(([category, items]) => (
              <GroupRows key={category} category={category} colSpan={props.branch ? 6 : 5}>
                {items.map((s) => {
                  const inBranch = props.branch
                    ? s.branches.find((b) => b.branchId === props.branch!.id)
                    : undefined;
                  return (
                    <TableRow key={s.id} className={s.active ? undefined : 'opacity-60'}>
                      <TableCell>
                        <div className="font-medium">{s.name}</div>
                        <div className="flex flex-wrap gap-1 pt-1">
                          {s.archived && <Badge variant="outline">Archivado</Badge>}
                          {!s.archived && !s.active && <Badge variant="outline">Inactivo</Badge>}
                          {!s.onlineBookable && <Badge variant="secondary">Solo en el local</Badge>}
                          {s.commissionBpsOverride !== null && (
                            <Badge variant="secondary">Comisión {formatBps(s.commissionBpsOverride)}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDuration(s.durationMin)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(s.basePriceCents)}
                      </TableCell>
                      {props.branch && (
                        <TableCell className="text-right tabular-nums">
                          {!inBranch?.offered ? (
                            <span className="text-muted-foreground">No se ofrece</span>
                          ) : inBranch.priceCentsOverride !== null ? (
                            <span className="font-medium">{formatCents(inBranch.priceCentsOverride)}</span>
                          ) : (
                            <span className="text-muted-foreground">Base</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="whitespace-nowrap text-sm">
                        {s.depositMode === 'FIXED'
                          ? formatCents(s.depositFixedCents ?? 0)
                          : s.depositMode === 'PERCENT'
                            ? formatBps(s.depositPercentBps)
                            : '—'}
                      </TableCell>
                      <TableCell>
                        {(props.canManage || props.canBranchPrices) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={pending}
                                aria-label={`Acciones para ${s.name}`}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {props.canManage && !s.archived && (
                                <DropdownMenuItem onSelect={() => setEditing(s)}>Editar</DropdownMenuItem>
                              )}
                              {props.canBranchPrices && props.branch && !s.archived && (
                                <DropdownMenuItem onSelect={() => setPricing(s)}>
                                  Precio en {props.branch.name}
                                </DropdownMenuItem>
                              )}
                              {props.canManage && (
                                <DropdownMenuItem
                                  variant={s.archived ? 'default' : 'destructive'}
                                  onSelect={() => setArchived(s, !s.archived)}
                                >
                                  {s.archived ? 'Recuperar' : 'Archivar'}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </GroupRows>
            ))}
          </TableBody>
        </Table>
      </div>
      {props.canManage && (
        <Link
          href={props.showArchived ? '/admin/servicios' : '/admin/servicios?archivados=1'}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {props.showArchived ? 'Ocultar archivados' : 'Ver archivados'}
        </Link>
      )}

      {editing && (
        <ServiceDialog
          key={editing.id}
          categories={props.categories}
          service={editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
      {pricing && props.branch && (
        <BranchPriceDialog
          key={pricing.id}
          kind="service"
          open
          onOpenChange={(open) => !open && setPricing(null)}
          branch={props.branch}
          item={{
            id: pricing.id,
            name: pricing.name,
            basePriceCents: pricing.basePriceCents,
            offered: pricing.branches.find((b) => b.branchId === props.branch!.id)?.offered ?? false,
            priceCentsOverride:
              pricing.branches.find((b) => b.branchId === props.branch!.id)?.priceCentsOverride ?? null,
          }}
        />
      )}
    </div>
  );
}

function GroupRows(props: { category: string; colSpan: number; children: React.ReactNode }) {
  return (
    <>
      <TableRow className="bg-muted/50 hover:bg-muted/50">
        <TableCell
          colSpan={props.colSpan}
          className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {props.category}
        </TableCell>
      </TableRow>
      {props.children}
    </>
  );
}
