'use client';

import type { CustomerMe } from '@estoicos/shared';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, ApiClientError } from '@/lib/api/client';

/**
 * Datos del cliente y consentimientos. Las casillas arrancan destildadas: el consentimiento
 * tiene que ser una decisión explícita (queda registrado con fecha y versión del texto).
 */
export function ProfileForm(props: {
  initial: CustomerMe;
  submitLabel: string;
  onSaved: (me: CustomerMe) => void;
}) {
  const { initial } = props;
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [preferredChannel, setPreferredChannel] = useState(initial.preferredChannel);
  const [transactional, setTransactional] = useState(initial.consents.transactional);
  const [marketing, setMarketing] = useState(initial.consents.marketing);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const me = await api<CustomerMe>('/v1/me/customer/profile', {
          method: 'PUT',
          body: {
            firstName,
            lastName,
            phone,
            preferredChannel,
            acceptTransactional: transactional,
            acceptMarketing: marketing,
          },
        });
        props.onSaved(me);
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo guardar.');
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="firstName">Nombre</Label>
          <Input
            id="firstName"
            autoComplete="given-name"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lastName">Apellido</Label>
          <Input
            id="lastName"
            autoComplete="family-name"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="phone">Celular (WhatsApp)</Label>
        <Input
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="11 2233-4455"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Con característica, sin el 0 ni el 15.</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="channel">¿Por dónde preferís los avisos?</Label>
        <Select
          value={preferredChannel}
          onValueChange={(v) => setPreferredChannel(v as CustomerMe['preferredChannel'])}
        >
          <SelectTrigger id="channel" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
            <SelectItem value="EMAIL">Email</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-3 rounded-lg border p-3">
        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            id="transactional"
            checked={transactional}
            onCheckedChange={(v) => setTransactional(v === true)}
            className="mt-0.5"
          />
          <span>Quiero recibir por WhatsApp y email la confirmación y los recordatorios de mis turnos.</span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            id="marketing"
            checked={marketing}
            onCheckedChange={(v) => setMarketing(v === true)}
            className="mt-0.5"
          />
          <span>Quiero recibir novedades, promociones y avisos de mis puntos.</span>
        </label>
        <p className="text-xs text-muted-foreground">Podés cambiar esto cuando quieras desde tu perfil.</p>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Guardando…' : props.submitLabel}
      </Button>
    </form>
  );
}
