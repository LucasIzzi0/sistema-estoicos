'use client';

import type { AppointmentDetail, SaleDetail } from '@estoicos/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, ApiClientError } from '@/lib/api/client';
import { CustomerPicker, type PickedCustomer } from '@/components/customer/customer-picker';
import { ServiceChecklist } from './service-checklist';
import type { AgendaBarber, AgendaService } from './types';

/** Atención sin turno: queda "en curso" desde ahora y ocupa la agenda del barbero. */
export function WalkInDialog(props: {
  branchId: string;
  barbers: AgendaBarber[];
  services: AgendaService[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [barberId, setBarberId] = useState('');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * El que llega sin turno casi siempre paga al toque. Con `cobrar` se registra la atención y
   * se abre su cobro directo, sin tener que buscarlo después en la agenda.
   */
  function submit(cobrar = false) {
    setError(null);
    startTransition(async () => {
      try {
        const cita = await api<AppointmentDetail>(`/v1/branches/${props.branchId}/walk-ins`, {
          body: { barberId, serviceIds, customerId: customer?.id ?? null },
        });
        if (cobrar) {
          const sale = await api<SaleDetail>(`/v1/appointments/${cita.id}/sale`, { body: {} });
          router.push(`/admin/caja/ventas/${sale.id}`);
          return;
        }
        toast.success('Atención registrada.');
        props.onSaved();
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo registrar.');
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Atención sin turno</DialogTitle>
          <DialogDescription>
            Empieza ahora. Registrar al cliente es opcional, pero sin registro no suma historial ni puntos.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Cliente</Label>
            <CustomerPicker value={customer} onChange={setCustomer} optional />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="walkin-barber">Barbero</Label>
            <Select value={barberId} onValueChange={setBarberId}>
              <SelectTrigger id="walkin-barber" className="w-full">
                <SelectValue placeholder="¿Quién lo atiende?" />
              </SelectTrigger>
              <SelectContent>
                {props.barbers.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Servicios</Label>
            <ServiceChecklist services={props.services} value={serviceIds} onChange={setServiceIds} />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={props.onClose}>
            Cancelar
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!barberId || !serviceIds.length || pending}
              onClick={() => submit(false)}
            >
              Empezar ahora
            </Button>
            <Button disabled={!barberId || !serviceIds.length || pending} onClick={() => submit(true)}>
              {pending ? 'Un segundo…' : 'Empezar y cobrar'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
