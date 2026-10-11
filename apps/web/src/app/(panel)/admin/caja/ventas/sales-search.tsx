'use client';

import { PAYMENT_METHOD_LABELS, SALE_STATUS_LABELS, type SaleListItem } from '@estoicos/shared';
import { Receipt, Search, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api/client';
import { formatCents, formatDateTime } from '@/lib/format';

/** Búsqueda al instante por número de venta o por cliente. */
export function SalesSearch({ branchId, initial }: { branchId: string; initial: SaleListItem[] }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(initial);
  const [buscando, setBuscando] = useState(false);
  const pedido = useRef(0);

  useEffect(() => {
    const texto = query.trim();
    const mio = ++pedido.current;
    setBuscando(texto.length > 0);
    const timer = setTimeout(
      async () => {
        const url = `/v1/branches/${branchId}/sales${texto ? `?q=${encodeURIComponent(texto)}` : ''}`;
        try {
          const data = await api<SaleListItem[]>(url);
          // Si mientras tanto siguió escribiendo, esta respuesta ya no sirve.
          if (mio === pedido.current) setResults(data);
        } catch {
          if (mio === pedido.current) setResults([]);
        } finally {
          if (mio === pedido.current) setBuscando(false);
        }
      },
      texto ? 250 : 0,
    );
    return () => clearTimeout(timer);
  }, [query, branchId]);

  return (
    <div className="grid gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-11 pl-9"
          placeholder="Buscar por número de venta (ej. 37) o por cliente"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {buscando
          ? 'Buscando…'
          : query.trim()
            ? `${results.length} ${results.length === 1 ? 'venta' : 'ventas'}`
            : 'Ventas de hoy y las que quedaron abiertas'}
      </p>

      {results.length === 0 ? (
        <EmptyState
          icon={query.trim() ? SearchX : Receipt}
          title={query.trim() ? 'No encontramos esa venta' : 'Todavía no hay ventas'}
          description={
            query.trim()
              ? 'Probá con el número exacto de la venta o con el nombre del cliente.'
              : 'Se cobra desde la agenda o con una venta de mostrador.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Venta</TableHead>
                <TableHead>Cliente y detalle</TableHead>
                <TableHead className="hidden sm:table-cell">Cuándo</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((s) => (
                <TableRow key={s.id} className="relative cursor-pointer">
                  <TableCell className="font-medium tabular-nums">
                    <Link href={`/admin/caja/ventas/${s.id}`} className="after:absolute after:inset-0">
                      #{s.number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{s.customerName ?? 'Sin cliente'}</div>
                    <div className="line-clamp-1 text-xs text-muted-foreground">{s.summary}</div>
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground sm:table-cell">
                    {formatDateTime(s.paidAt ?? s.createdAt)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <div>{formatCents(s.totalCents)}</div>
                    {s.methods.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {s.methods.map((m) => PAYMENT_METHOD_LABELS[m]).join(' + ')}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        s.status === 'PAID' ? 'secondary' : s.status === 'VOIDED' ? 'destructive' : 'default'
                      }
                    >
                      {SALE_STATUS_LABELS[s.status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
