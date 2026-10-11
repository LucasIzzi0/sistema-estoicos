'use client';

import { RECONCILIATION_LABELS, type MpInboxItem, type MpPaymentDto } from '@estoicos/shared';
import { Inbox } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { CustomerPicker, type PickedCustomer } from '@/components/customer/customer-picker';
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
import { api, ApiClientError } from '@/lib/api/client';
import { formatCents, formatDateTime } from '@/lib/format';

/**
 * Bandeja "Pagos sin asignar": todo pago aprobado de la cuenta termina vinculado a una venta,
 * marcado como otro ingreso o ignorado con motivo. Las sugerencias son una ayuda; decide una
 * persona y queda auditado.
 */
export function PaymentsInbox({ initial }: { initial: MpInboxItem[] }) {
  const [items, setItems] = useState(initial);
  const [manual, setManual] = useState<MpInboxItem | null>(null);
  const [pending, startTransition] = useTransition();

  function assign(item: MpInboxItem, body: object, success: string) {
    startTransition(async () => {
      try {
        await api<MpPaymentDto>(`/v1/mercadopago/payments/${item.id}/assign`, { body });
        setItems((list) => list.filter((x) => x.id !== item.id));
        setManual(null);
        toast.success(success);
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo asignar.');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Inbox className="size-5" /> Pagos sin asignar
          {items.length > 0 && <Badge variant="destructive">{items.length}</Badge>}
        </CardTitle>
        <CardDescription>
          Cobros que entraron a la cuenta de Mercado Pago y todavía no están atados a una venta.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todo en orden: no hay pagos esperando.</p>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id} className="grid gap-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="grid">
                    <span className="font-semibold tabular-nums">{formatCents(item.amountCents)}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(item.dateApproved ?? item.dateCreated)}
                      {item.paymentMethod ? ` · ${item.paymentMethod}` : ''}
                      {item.payerName ? ` · ${item.payerName}` : ''}
                      {item.branchName ? ` · ${item.branchName}` : ''}
                    </span>
                  </span>
                  <Badge variant="outline">{RECONCILIATION_LABELS[item.reconciliationStatus]}</Badge>
                </div>
                {item.description && <p className="text-sm">{item.description}</p>}
                <div className="flex flex-wrap gap-2">
                  {item.suggestions.map((s) => (
                    <Button
                      key={s.id}
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        assign(item, { target: 'SALE', saleId: s.id }, `Pago asignado a ${s.label}.`)
                      }
                    >
                      {s.label}
                      <span className="text-xs text-muted-foreground">({s.reasons.join(', ')})</span>
                    </Button>
                  ))}
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => setManual(item)}>
                    Otra opción…
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {manual && (
        <ManualDialog
          item={manual}
          pending={pending}
          onClose={() => setManual(null)}
          onAssign={(body, success) => assign(manual, body, success)}
        />
      )}
    </Card>
  );
}

function ManualDialog(props: {
  item: MpInboxItem;
  pending: boolean;
  onClose: () => void;
  onAssign: (body: object, success: string) => void;
}) {
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>¿Qué es este pago de {formatCents(props.item.amountCents)}?</DialogTitle>
          <DialogDescription>
            {formatDateTime(props.item.dateApproved ?? props.item.dateCreated)}
            {props.item.description ? ` · ${props.item.description}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Saldo a favor de un cliente</Label>
            <CustomerPicker value={customer} onChange={setCustomer} optional />
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={!customer || props.pending}
              onClick={() =>
                props.onAssign(
                  { target: 'CUSTOMER_CREDIT', customerId: customer!.id },
                  `Quedó como saldo a favor de ${customer!.name}.`,
                )
              }
            >
              Cargar como saldo a favor
            </Button>
          </div>
          <div className="grid gap-1.5 border-t pt-3">
            <Label htmlFor="mp-other">Otro ingreso (no es una venta)</Label>
            <Input
              id="mp-other"
              placeholder="Ej.: venta de un mueble"
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={description.trim().length < 2 || props.pending}
              onClick={() =>
                props.onAssign(
                  { target: 'OTHER_INCOME', description: description.trim() },
                  'Marcado como otro ingreso.',
                )
              }
            >
              Marcar como otro ingreso
            </Button>
          </div>
          <div className="grid gap-1.5 border-t pt-3">
            <Label htmlFor="mp-ignore">Ignorar (no tiene que ver con la barbería)</Label>
            <Input
              id="mp-ignore"
              placeholder="Motivo"
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              variant="ghost"
              size="sm"
              className="w-fit text-destructive"
              disabled={reason.trim().length < 2 || props.pending}
              onClick={() => props.onAssign({ target: 'IGNORED', reason: reason.trim() }, 'Pago ignorado.')}
            >
              Ignorar este pago
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Volver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
