'use client';

import type { BranchSummary, Category, ProductDto } from '@estoicos/shared';
import { MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { BranchPriceDialog } from '@/components/catalog/branch-price-dialog';
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
import { formatCents } from '@/lib/format';
import { ProductDialog } from './product-dialog';

export function ProductsTable(props: {
  products: ProductDto[];
  categories: Category[];
  branch: BranchSummary | null;
  canManage: boolean;
  canBranchPrices: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ProductDto | null>(null);
  const [pricing, setPricing] = useState<ProductDto | null>(null);
  const [pending, startTransition] = useTransition();

  function setArchived(product: ProductDto, archived: boolean) {
    startTransition(async () => {
      try {
        await api(`/v1/products/${product.id}`, { method: 'PATCH', body: { archived } });
        router.refresh();
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo actualizar.');
      }
    });
  }

  if (props.products.length === 0) {
    return <p className="text-sm text-muted-foreground">Todavía no hay productos cargados.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Producto</TableHead>
            <TableHead>Categoría</TableHead>
            <TableHead className="text-right">Precio</TableHead>
            {props.branch && <TableHead className="text-right">En {props.branch.name}</TableHead>}
            <TableHead className="text-right">Margen</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Acciones</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.products.map((x) => {
            const inBranch = props.branch
              ? x.branches.find((b) => b.branchId === props.branch!.id)
              : undefined;
            const margin =
              x.costCents && x.basePriceCents > 0
                ? Math.round(((x.basePriceCents - x.costCents) / x.basePriceCents) * 100)
                : null;
            return (
              <TableRow key={x.id} className={x.active ? undefined : 'opacity-60'}>
                <TableCell>
                  <div className="font-medium">{x.name}</div>
                  <div className="flex flex-wrap gap-1 pt-1 text-xs text-muted-foreground">
                    {x.sku && <span>{x.sku}</span>}
                    {x.archived && <Badge variant="outline">Archivado</Badge>}
                  </div>
                </TableCell>
                <TableCell>{x.categoryName ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCents(x.basePriceCents)}</TableCell>
                {props.branch && (
                  <TableCell className="text-right tabular-nums">
                    {!inBranch?.offered ? (
                      <span className="text-muted-foreground">No se vende</span>
                    ) : inBranch.priceCentsOverride !== null ? (
                      <span className="font-medium">{formatCents(inBranch.priceCentsOverride)}</span>
                    ) : (
                      <span className="text-muted-foreground">Base</span>
                    )}
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums">
                  {margin === null ? '—' : `${margin} %`}
                </TableCell>
                <TableCell>
                  {(props.canManage || props.canBranchPrices) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={pending}
                          aria-label={`Acciones para ${x.name}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {props.canManage && !x.archived && (
                          <DropdownMenuItem onSelect={() => setEditing(x)}>Editar</DropdownMenuItem>
                        )}
                        {props.canBranchPrices && props.branch && !x.archived && (
                          <DropdownMenuItem onSelect={() => setPricing(x)}>
                            Precio en {props.branch.name}
                          </DropdownMenuItem>
                        )}
                        {props.canManage && (
                          <DropdownMenuItem
                            variant={x.archived ? 'default' : 'destructive'}
                            onSelect={() => setArchived(x, !x.archived)}
                          >
                            {x.archived ? 'Recuperar' : 'Archivar'}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {editing && (
        <ProductDialog
          key={editing.id}
          categories={props.categories}
          product={editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
      {pricing && props.branch && (
        <BranchPriceDialog
          key={pricing.id}
          kind="product"
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
