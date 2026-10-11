'use client';

import { PAYMENT_METHOD_LABELS, type ExpenseDto } from '@estoicos/shared';
import { Ban } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, ApiClientError } from '@/lib/api/client';
import { formatCents, formatDay } from '@/lib/format';

export function ExpensesTable({ month, expenses }: { month: string; expenses: ExpenseDto[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = expenses.filter((e) => !e.voidedAt);
  const total = active.reduce((a, e) => a + e.amountCents, 0);

  const [voiding, setVoiding] = useState<ExpenseDto | null>(null);
  const [reason, setReason] = useState('');

  function confirmVoid() {
    const e = voiding!;
    startTransition(async () => {
      try {
        await api(`/v1/expenses/${e.id}/void`, { body: { reason: reason.trim() } });
        toast.success('Egreso anulado.');
        setVoiding(null);
        setReason('');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof ApiClientError ? err.message : 'No se pudo anular.');
      }
    });
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          type="month"
          aria-label="Mes"
          className="w-44"
          value={month}
          onChange={(e) => e.target.value && router.push(`/admin/caja/egresos?mes=${e.target.value}`)}
        />
        <p className="text-sm">
          Total del mes: <span className="font-bold tabular-nums">{formatCents(total)}</span>
        </p>
      </div>
      {expenses.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No hay egresos este mes.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Detalle</TableHead>
                <TableHead className="hidden md:table-cell">Categoría</TableHead>
                <TableHead className="hidden sm:table-cell">Medio</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((e) => (
                <TableRow key={e.id} className={e.voidedAt ? 'opacity-50' : ''}>
                  <TableCell className="whitespace-nowrap">
                    {formatDay(e.occurredOn, { year: undefined })}
                  </TableCell>
                  <TableCell>
                    <span className={e.voidedAt ? 'line-through' : ''}>{e.description}</span>
                    <div className="text-xs text-muted-foreground">
                      {e.branchName ?? 'General'}
                      {e.supplier ? ` · ${e.supplier}` : ''}
                      {e.fromCashSession ? ' · de la caja' : ''}
                      {e.voidReason ? ` · anulado: ${e.voidReason}` : ''}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{e.categoryName}</TableCell>
                  <TableCell className="hidden sm:table-cell">{PAYMENT_METHOD_LABELS[e.method]}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(e.amountCents)}</TableCell>
                  <TableCell className="text-right">
                    {e.voidedAt ? (
                      <Badge variant="outline">Anulado</Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Anular"
                        disabled={pending}
                        onClick={() => setVoiding(e)}
                      >
                        <Ban />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {voiding && (
        <Dialog open onOpenChange={(o) => !o && setVoiding(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>¿Anular el egreso?</DialogTitle>
              <DialogDescription>
                {voiding.description} · {formatCents(voiding.amountCents)}. Queda registrado con el motivo.
              </DialogDescription>
            </DialogHeader>
            <Input
              aria-label="Motivo"
              placeholder="Motivo (obligatorio)"
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setVoiding(null)}>
                Volver
              </Button>
              <Button
                variant="destructive"
                disabled={reason.trim().length < 3 || pending}
                onClick={confirmVoid}
              >
                Anular
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
