'use client';

import type { CustomerListItem } from '@estoicos/shared';
import { Search, UserPlus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CustomerForm } from '@/components/customer/customer-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/client';
import { formatPhone } from '@/lib/format';

export interface PickedCustomer {
  id: string;
  name: string;
  phone: string | null;
}

/** Buscar cliente por nombre, celular, email o DNI; o darlo de alta sin salir del turno. */
export function CustomerPicker(props: {
  value: PickedCustomer | null;
  onChange: (value: PickedCustomer | null) => void;
  optional?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerListItem[]>([]);
  const [creating, setCreating] = useState(false);
  const lastRequest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const id = ++lastRequest.current;
    const timer = setTimeout(async () => {
      const data = await api<CustomerListItem[]>(`/v1/customers?q=${encodeURIComponent(q)}&limit=6`).catch(
        () => [],
      );
      if (id === lastRequest.current) setResults(data);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  if (props.value) {
    return (
      <div className="flex items-center gap-2 rounded-md border px-3 py-2">
        <span className="grid flex-1">
          <span className="font-medium">{props.value.name}</span>
          {props.value.phone && (
            <span className="text-xs text-muted-foreground">{formatPhone(props.value.phone)}</span>
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Cambiar cliente"
          onClick={() => props.onChange(null)}
        >
          <X />
        </Button>
      </div>
    );
  }

  if (creating) {
    return (
      <div className="grid gap-3 rounded-md border p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Nuevo cliente</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
            Volver a buscar
          </Button>
        </div>
        <CustomerForm
          onSaved={(c) => {
            setCreating(false);
            props.onChange({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim(), phone: c.phone });
          }}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Buscar cliente"
          placeholder="Nombre, celular, email o DNI"
          className="pl-9"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {results.length > 0 && (
        <ul className="divide-y rounded-md border">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() =>
                  props.onChange({
                    id: c.id,
                    name: `${c.firstName} ${c.lastName}`.trim() || c.email || 'Cliente',
                    phone: c.phone,
                  })
                }
              >
                <span className="font-medium">{`${c.firstName} ${c.lastName}`.trim() || c.email}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {c.phone ? formatPhone(c.phone) : c.email}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
          <UserPlus /> Nuevo cliente
        </Button>
        {props.optional && <span className="self-center text-xs text-muted-foreground">Opcional</span>}
      </div>
    </div>
  );
}
