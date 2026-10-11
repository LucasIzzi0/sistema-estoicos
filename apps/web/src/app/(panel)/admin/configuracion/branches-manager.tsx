'use client';

import type { BranchDetail, ClosureDto } from '@estoicos/shared';
import { CalendarOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Switch } from '@/components/ui/switch';
import { api, ApiClientError } from '@/lib/api/client';
import { formatRange } from '@/lib/format';

export function BranchesManager(props: {
  branches: BranchDetail[];
  canManage: boolean;
  canClosures: boolean;
}) {
  const [editing, setEditing] = useState<BranchDetail | 'new' | null>(null);
  const [closuresOf, setClosuresOf] = useState<BranchDetail | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1.5">
          <CardTitle className="text-lg">Sucursales</CardTitle>
          <CardDescription>Datos de cada local, link público de reservas y feriados.</CardDescription>
        </div>
        {props.canManage && (
          <Button variant="outline" onClick={() => setEditing('new')}>
            <Plus />
            Nueva sucursal
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-3">
        {props.branches.map((b) => (
          <div
            key={b.id}
            className={`flex flex-wrap items-start gap-3 rounded-lg border p-3 ${b.active ? '' : 'opacity-60'}`}
          >
            <div className="grid flex-1 gap-1 text-sm">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                {b.name}
                {!b.active && <Badge variant="outline">Inactiva</Badge>}
                {!b.bookingEnabled && <Badge variant="secondary">Sin reservas online</Badge>}
              </div>
              <span className="text-muted-foreground">
                {[b.address, b.city].filter(Boolean).join(', ') || 'Sin dirección'}
              </span>
              <span className="text-muted-foreground">Reservas: /reservar/{b.slug}</span>
              {!b.googleReviewUrl && (
                <span className="text-xs text-warning">
                  Falta el link de reseñas de Google
                </span>
              )}
            </div>
            <div className="flex gap-2">
              {props.canClosures && (
                <Button variant="outline" size="sm" onClick={() => setClosuresOf(b)}>
                  <CalendarOff />
                  Feriados
                </Button>
              )}
              {props.canManage && (
                <Button variant="outline" size="sm" onClick={() => setEditing(b)}>
                  <Pencil />
                  Editar
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
      {editing && (
        <BranchDialog
          key={editing === 'new' ? 'new' : editing.id}
          branch={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {closuresOf && (
        <ClosuresDialog key={closuresOf.id} branch={closuresOf} onClose={() => setClosuresOf(null)} />
      )}
    </Card>
  );
}

function BranchDialog(props: { branch?: BranchDetail; onClose: () => void }) {
  const router = useRouter();
  const b = props.branch;
  const [name, setName] = useState(b?.name ?? '');
  const [slug, setSlug] = useState(b?.slug ?? '');
  const [address, setAddress] = useState(b?.address ?? '');
  const [city, setCity] = useState(b?.city ?? '');
  const [phone, setPhone] = useState(b?.phone ?? '');
  const [googleReviewUrl, setGoogleReviewUrl] = useState(b?.googleReviewUrl ?? '');
  const [bookingEnabled, setBookingEnabled] = useState(b?.bookingEnabled ?? true);
  const [active, setActive] = useState(b?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function suggestSlug(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const body = {
      name,
      slug,
      address: address || null,
      city: city || null,
      phone: phone || null,
      googleReviewUrl: googleReviewUrl || null,
      bookingEnabled,
      active,
    };
    startTransition(async () => {
      try {
        await api(b ? `/v1/branches/${b.id}` : '/v1/branches', { method: b ? 'PATCH' : 'POST', body });
        toast.success(
          b ? 'Sucursal actualizada.' : `Sucursal ${name} creada con todos los servicios y productos.`,
        );
        props.onClose();
        router.refresh();
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo guardar.');
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{b ? `Editar ${b.name}` : 'Nueva sucursal'}</DialogTitle>
          <DialogDescription>Los cambios quedan registrados.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="br-name">Nombre</Label>
            <Input
              id="br-name"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!b) setSlug(suggestSlug(e.target.value));
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="br-slug">Link de reservas</Label>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              /reservar/
              <Input
                id="br-slug"
                required
                value={slug}
                onChange={(e) => setSlug(suggestSlug(e.target.value))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="br-address">Dirección</Label>
              <Input id="br-address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="br-city">Ciudad</Label>
              <Input id="br-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="br-phone">Teléfono del local</Label>
            <Input id="br-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="br-review">Link para dejar reseña en Google</Label>
            <Input
              id="br-review"
              type="url"
              placeholder="https://g.page/r/…/review"
              value={googleReviewUrl}
              onChange={(e) => setGoogleReviewUrl(e.target.value)}
            />
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            Recibe reservas online
            <Switch checked={bookingEnabled} onCheckedChange={setBookingEnabled} />
          </label>
          {b && (
            <label className="flex items-center justify-between gap-3 text-sm">
              Activa
              <Switch checked={active} onCheckedChange={setActive} />
            </label>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : b ? 'Guardar' : 'Crear sucursal'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ClosuresDialog(props: { branch: BranchDetail; onClose: () => void }) {
  const [closures, setClosures] = useState<ClosureDto[] | null>(null);
  const [date, setDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const base = `/v1/branches/${props.branch.id}/closures`;

  useEffect(() => {
    api<ClosureDto[]>(base)
      .then(setClosures)
      .catch(() => setClosures([]));
  }, [base]);

  function add(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        setClosures(await api<ClosureDto[]>(base, { body: { date, endDate: endDate || null, reason } }));
        setDate('');
        setEndDate('');
        setReason('');
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo agregar.');
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      setClosures(await api<ClosureDto[]>(`${base}/${id}`, { method: 'DELETE' }));
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Feriados y cierres · {props.branch.name}</DialogTitle>
          <DialogDescription>Esos días nadie puede reservar en esta sucursal.</DialogDescription>
        </DialogHeader>
        <form onSubmit={add} className="grid gap-3 rounded-lg border p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cl-date">Desde</Label>
              <Input
                id="cl-date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cl-end">Hasta (opcional)</Label>
              <Input id="cl-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cl-reason">Motivo</Label>
            <Input
              id="cl-reason"
              required
              placeholder="Feriado 9 de julio"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" size="sm" className="w-fit" disabled={pending}>
            Agregar
          </Button>
        </form>
        {closures === null ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : closures.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay cierres próximos.</p>
        ) : (
          <ul className="grid gap-2">
            {closures.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-lg border p-2 text-sm">
                <span className="font-medium">{formatRange(c.startsAt, c.endsAt)}</span>
                <span className="flex-1 text-muted-foreground">{c.reason}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Borrar cierre"
                  disabled={pending}
                  onClick={() => remove(c.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
