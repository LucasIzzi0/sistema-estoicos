'use client';

import {
  STOCK_ADJUST_TYPES,
  STOCK_MOVEMENT_LABELS,
  type StockItem,
  type StockMovementDto,
} from '@estoicos/shared';
import { AlertTriangle, History, PackagePlus, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { MoneyInput } from '@/components/form/money-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, ApiClientError } from '@/lib/api/client';
import { formatCents, formatDateTime } from '@/lib/format';

type Mode = { kind: 'purchase' | 'adjust' | 'min' | 'history'; item: StockItem };

export function StockTable(props: { branchId: string; initial: StockItem[]; canAdjust: boolean }) {
  const [items, setItems] = useState(props.initial);
  const [mode, setMode] = useState<Mode | null>(null);
  const low = items.filter((i) => i.low);

  return (
    <div className="grid gap-3">
      {low.length > 0 && (
        <p className="flex items-center gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
          <AlertTriangle className="size-4 text-warning" />
          Stock bajo: {low.map((i) => `${i.name} (${i.stockOnHand})`).join(', ')}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Mínimo</TableHead>
              <TableHead className="hidden text-right md:table-cell">Costo</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.productId}>
                <TableCell>
                  <span className="font-medium">{i.name}</span>
                  <div className="text-xs text-muted-foreground">
                    {[i.categoryName, i.sku].filter(Boolean).join(' · ')}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-semibold tabular-nums">{i.stockOnHand}</span>
                  {i.low && (
                    <Badge variant="destructive" className="ml-2">
                      {i.stockOnHand < 0 ? 'Negativo' : 'Bajo'}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">
                  {i.minStock ?? '—'}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  {i.costCents === null ? '—' : formatCents(i.costCents)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {props.canAdjust && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Compra de ${i.name}`}
                          onClick={() => setMode({ kind: 'purchase', item: i })}
                        >
                          <PackagePlus />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Ajustar ${i.name}`}
                          onClick={() => setMode({ kind: 'adjust', item: i })}
                        >
                          <SlidersHorizontal />
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Historial de ${i.name}`}
                      onClick={() => setMode({ kind: 'history', item: i })}
                    >
                      <History />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {mode && mode.kind !== 'history' && (
        <StockDialog
          branchId={props.branchId}
          mode={mode}
          onClose={() => setMode(null)}
          onSaved={(list) => {
            setItems(list);
            setMode(null);
          }}
        />
      )}
      {mode?.kind === 'history' && (
        <HistoryDialog branchId={props.branchId} item={mode.item} onClose={() => setMode(null)} />
      )}
    </div>
  );
}

function StockDialog(props: {
  branchId: string;
  mode: Mode;
  onClose: () => void;
  onSaved: (list: StockItem[]) => void;
}) {
  const { item, kind } = props.mode;
  const [quantity, setQuantity] = useState('');
  const [cost, setCost] = useState<number | null>(item.costCents);
  const [type, setType] = useState<(typeof STOCK_ADJUST_TYPES)[number]>('ADJUSTMENT_OUT');
  const [reason, setReason] = useState('');
  const [min, setMin] = useState(item.minStock === null ? '' : String(item.minStock));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const base = `/v1/branches/${props.branchId}/stock/${item.productId}`;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const list =
          kind === 'purchase'
            ? await api<StockItem[]>(`${base}/purchases`, {
                body: { quantity: Number(quantity), unitCostCents: cost },
              })
            : await api<StockItem[]>(`${base}/adjustments`, {
                body: { type, quantity: Number(quantity), reason },
              });
        if (min !== (item.minStock === null ? '' : String(item.minStock))) {
          props.onSaved(
            await api<StockItem[]>(`${base}/min`, {
              method: 'PUT',
              body: { minStock: min === '' ? null : Number(min) },
            }),
          );
        } else props.onSaved(list);
        toast.success(kind === 'purchase' ? 'Compra registrada.' : 'Ajuste registrado.');
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : 'No se pudo guardar.');
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {kind === 'purchase' ? 'Compra' : 'Ajuste'}: {item.name}
          </DialogTitle>
          <DialogDescription>Stock actual: {item.stockOnHand}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-3">
          {kind === 'adjust' && (
            <div className="grid gap-1.5">
              <Label htmlFor="adj-type">Tipo</Label>
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                <SelectTrigger id="adj-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STOCK_ADJUST_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {STOCK_MOVEMENT_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="st-qty">Cantidad</Label>
              <Input
                id="st-qty"
                type="number"
                min={1}
                required
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            {kind === 'purchase' ? (
              <div className="grid gap-1.5">
                <Label htmlFor="st-cost">Costo unitario</Label>
                <MoneyInput id="st-cost" value={cost} onChange={setCost} />
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="st-min">Mínimo (alerta)</Label>
                <Input
                  id="st-min"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={min}
                  onChange={(e) => setMin(e.target.value)}
                />
              </div>
            )}
          </div>
          {kind === 'adjust' ? (
            <div className="grid gap-1.5">
              <Label htmlFor="st-reason">Motivo</Label>
              <Input
                id="st-reason"
                required
                minLength={3}
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej.: recuento, se rompió, uso en el local"
              />
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="st-min2">Mínimo (alerta)</Label>
              <Input
                id="st-min2"
                type="number"
                min={0}
                inputMode="numeric"
                value={min}
                onChange={(e) => setMin(e.target.value)}
              />
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending || !Number(quantity)}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog(props: { branchId: string; item: StockItem; onClose: () => void }) {
  const [rows, setRows] = useState<StockMovementDto[] | null>(null);
  const url = `/v1/branches/${props.branchId}/stock/${props.item.productId}/movements`;
  useEffect(() => {
    let cancelled = false;
    api<StockMovementDto[]>(url)
      .then((data) => !cancelled && setRows(data))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Historial: {props.item.name}</DialogTitle>
          <DialogDescription>Últimos 100 movimientos.</DialogDescription>
        </DialogHeader>
        {!rows ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin movimientos.</p>
        ) : (
          <ul className="divide-y text-sm">
            {rows.map((m) => (
              <li key={m.id} className="flex justify-between gap-3 py-2">
                <span className="grid">
                  <span>
                    {STOCK_MOVEMENT_LABELS[m.type] ?? m.type}
                    {m.saleNumber ? ` · venta #${m.saleNumber}` : ''}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(m.createdAt)}
                    {m.createdByName ? ` · ${m.createdByName}` : ''}
                    {m.reason ? ` · ${m.reason}` : ''}
                  </span>
                </span>
                <span className="text-right tabular-nums">
                  <span className={m.quantity > 0 ? 'text-success' : ''}>
                    {m.quantity > 0 ? '+' : ''}
                    {m.quantity}
                  </span>
                  <span className="block text-xs text-muted-foreground">queda {m.balanceAfter}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
