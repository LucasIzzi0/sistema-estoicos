'use client';

import type { CustomerListItem } from '@estoicos/shared';
import { Search, SearchX, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api/client';
import { formatDate, formatPhone } from '@/lib/format';

/** Búsqueda al instante por nombre, email, celular o DNI (sin importar acentos ni mayúsculas). */
export function CustomerSearch({ initial }: { initial: CustomerListItem[] }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(initial);
  const [loading, setLoading] = useState(false);
  const lastRequest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(initial);
      return;
    }
    const id = ++lastRequest.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api<CustomerListItem[]>(`/v1/customers?q=${encodeURIComponent(q)}&limit=50`);
        if (id === lastRequest.current) setResults(data);
      } finally {
        if (id === lastRequest.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, initial]);

  return (
    <div className="grid gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          autoFocus
          aria-label="Buscar clientes"
          placeholder="Buscar por nombre, celular, email o DNI"
          className="h-11 pl-9"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {loading
          ? 'Buscando…'
          : query.trim()
            ? `${results.length} resultado${results.length === 1 ? '' : 's'}`
            : 'Últimos registrados'}
      </p>
      {results.length === 0 ? (
        <EmptyState
          icon={query.trim() ? SearchX : UserPlus}
          title={query.trim() ? 'No encontramos a nadie' : 'Todavía no hay clientes'}
          description={
            query.trim()
              ? `Probá con el apellido, el celular o el email. Buscaste “${query}”.`
              : 'El primero se carga desde acá o se registra solo cuando reserva online.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Celular</TableHead>
                <TableHead className="hidden md:table-cell">Email</TableHead>
                <TableHead className="hidden sm:table-cell">Última visita</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((c) => (
                <TableRow key={c.id} className="relative cursor-pointer">
                  <TableCell>
                    <span className="flex items-center gap-2.5">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold uppercase text-muted-foreground">
                        {initials(c.firstName, c.lastName)}
                      </span>
                      <Link
                        href={`/admin/clientes/${c.id}`}
                        className="font-medium after:absolute after:inset-0 hover:underline"
                      >
                        {c.firstName || c.lastName ? `${c.firstName} ${c.lastName}` : 'Perfil incompleto'}
                      </Link>
                    </span>
                    {!c.firstName && !c.lastName && c.email && (
                      <div className="text-xs text-muted-foreground">{c.email}</div>
                    )}
                    {c.dni && <div className="text-xs text-muted-foreground">DNI {c.dni}</div>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {c.phone ? formatPhone(c.phone) : '—'}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{c.email ?? '—'}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {c.lastVisitAt ? formatDate(c.lastVisitAt) : 'Nunca'}
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

/** Iniciales para el avatar de la lista. */
function initials(firstName: string, lastName: string): string {
  const letters = `${firstName.trim()[0] ?? ''}${lastName.trim()[0] ?? ''}`.trim();
  return letters || '—';
}
