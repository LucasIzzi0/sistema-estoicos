'use client';

import type { CustomerDetail, DuplicateMatch } from '@estoicos/shared';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, ApiClientError } from '@/lib/api/client';
import { formatPhone } from '@/lib/format';

/**
 * Formulario de cliente para el staff: alta rápida (una sola pantalla) o edición.
 * El email es obligatorio (decisión del 25/09/2026); el DNI, opcional.
 */
export function CustomerForm(props: { customer?: CustomerDetail; onSaved: (c: CustomerDetail) => void }) {
  const c = props.customer;
  const [firstName, setFirstName] = useState(c?.firstName ?? '');
  const [lastName, setLastName] = useState(c?.lastName ?? '');
  const [phone, setPhone] = useState(c?.phone ? formatPhone(c.phone) : '');
  const [email, setEmail] = useState(c?.email ?? '');
  const [dni, setDni] = useState(c?.dni ?? '');
  const [channel, setChannel] = useState<CustomerDetail['preferredChannel']>(
    c?.preferredChannel ?? 'WHATSAPP',
  );
  const [transactional, setTransactional] = useState(c?.consents.transactional ?? false);
  const [marketing, setMarketing] = useState(c?.consents.marketing ?? false);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<{ code: string; list: DuplicateMatch[] } | null>(null);
  const [pending, startTransition] = useTransition();

  function save(allowSamePhone = false) {
    setError(null);
    setMatches(null);
    const body = {
      firstName,
      lastName,
      phone,
      email,
      dni: dni.trim() || null,
      preferredChannel: channel,
      acceptTransactional: transactional,
      acceptMarketing: marketing,
      ...(c ? {} : { allowSamePhone }),
    };
    startTransition(async () => {
      try {
        const saved = await api<CustomerDetail>(c ? `/v1/customers/${c.id}` : '/v1/customers', {
          method: c ? 'PATCH' : 'POST',
          body,
        });
        props.onSaved(saved);
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 409) {
          const list = (e.details as { matches?: DuplicateMatch[] } | undefined)?.matches ?? [];
          setMatches({ code: e.code, list });
        }
        setError(e instanceof ApiClientError ? e.message : 'No se pudo guardar.');
      }
    });
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="cf-first">Nombre</Label>
          <Input
            id="cf-first"
            required
            autoFocus={!c}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cf-last">Apellido</Label>
          <Input id="cf-last" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cf-phone">Celular (WhatsApp)</Label>
        <Input
          id="cf-phone"
          type="tel"
          inputMode="tel"
          required
          placeholder="11 2233-4455"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cf-email">Email</Label>
        <Input
          id="cf-email"
          type="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="cf-dni">DNI (opcional)</Label>
          <Input id="cf-dni" inputMode="numeric" value={dni} onChange={(e) => setDni(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cf-channel">Avisos por</Label>
          <Select value={channel} onValueChange={(v) => setChannel(v as CustomerDetail['preferredChannel'])}>
            <SelectTrigger id="cf-channel" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
              <SelectItem value="EMAIL">Email</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-3 rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">Preguntale al cliente y marcá lo que acepte:</p>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            checked={transactional}
            onCheckedChange={(v) => setTransactional(v === true)}
            className="mt-0.5"
          />
          Avisos de sus turnos (confirmación y recordatorios) por WhatsApp y email
        </label>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            checked={marketing}
            onCheckedChange={(v) => setMarketing(v === true)}
            className="mt-0.5"
          />
          Novedades, promociones y avisos de puntos
        </label>
      </div>

      {error && (
        <div
          className="grid gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
          role="alert"
        >
          <p>{error}</p>
          {matches?.list.map((m) => (
            <Link
              key={m.id}
              href={`/admin/clientes/${m.id}`}
              className="font-medium underline underline-offset-4"
            >
              Ver ficha de {m.name}
            </Link>
          ))}
          {matches?.code === 'POSSIBLE_DUPLICATE' && !c && (
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => save(true)}>
              Es otra persona: crear igual
            </Button>
          )}
        </div>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Guardando…' : c ? 'Guardar cambios' : 'Crear cliente'}
      </Button>
    </form>
  );
}
