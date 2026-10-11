'use client';

import {
  PAYMENT_METHOD_LABELS,
  type MpTerminalDto,
  SALE_ITEM_TYPE_LABELS,
  SALE_STATUS_LABELS,
  type SaleDetail,
  type SaleItemDto,
} from '@estoicos/shared';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Minus,
  Percent,
  Plus,
  Scissors as ScissorsIcon,
  Trash2,
  Undo2,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { CustomerPicker, type PickedCustomer } from '@/components/customer/customer-picker';
import { EmptyState } from '@/components/empty-state';
import { MoneyInput } from '@/components/form/money-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { api, ApiClientError } from '@/lib/api/client';
import { formatCents, formatDateTime } from '@/lib/format';
import { LoyaltyPanel } from './loyalty-panel';
import { PayDialog } from './pay-dialog';

type Option = { id: string; name: string; priceCents: number };

/** Armar y cobrar una venta: servicios del turno, productos, propina, descuentos (admin). */
export function SaleEditor(props: {
  initial: SaleDetail;
  products: Option[];
  services: Option[];
  barbers: { id: string; displayName: string }[];
  terminals: MpTerminalDto[];
  /** Sin caja abierta no se puede cobrar: conviene avisarlo antes de armar la venta. */
  cashOpen: boolean;
  canOpenCash: boolean;
  canDiscount: boolean;
  canVoid: boolean;
  canRefund: boolean;
}) {
  const router = useRouter();
  const [sale, setSale] = useState(props.initial);
  const [pending, startTransition] = useTransition();
  const [discountFor, setDiscountFor] = useState<SaleItemDto | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [refunding, setRefunding] = useState<SaleDetail['payments'][number] | null>(null);
  const open = sale.status === 'OPEN';
  // El barbero del turno queda preseleccionado; en una venta de mostrador, nadie: la comisión de
  // un producto se asigna solo si alguien la elige.
  const defaultBarber = sale.items.find((i) => i.barberId)?.barberId ?? '';
  const [quickBarber, setQuickBarber] = useState(defaultBarber || (props.barbers[0]?.id ?? ''));

  function run(action: () => Promise<SaleDetail>, success?: string) {
    startTransition(async () => {
      try {
        setSale(await action());
        if (success) toast.success(success);
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo guardar.');
      }
    });
  }

  function finish(paid: SaleDetail) {
    setSale(paid);
    toast.success(`Venta #${paid.number} cobrada.`);
    for (const w of paid.stockWarnings) {
      toast.warning(`Stock bajo: ${w.productName} (quedan ${w.stockOnHand}).`);
    }
    router.refresh();
  }

  const addItem = (body: object) => run(() => api<SaleDetail>(`/v1/sales/${sale.id}/items`, { body }));
  const updateItem = (itemId: string, body: object) =>
    run(() => api<SaleDetail>(`/v1/sales/${sale.id}/items/${itemId}`, { method: 'PATCH', body }));

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <Link
        href="/admin/caja"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Caja y Ventas
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="flex items-center gap-3 text-3xl font-extrabold uppercase">
            Venta #{sale.number}
            <Badge variant={open ? 'default' : sale.status === 'VOIDED' ? 'destructive' : 'secondary'}>
              {SALE_STATUS_LABELS[sale.status]}
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {sale.appointmentId ? 'Desde un turno de la agenda' : 'Venta de mostrador'} · creada{' '}
            {formatDateTime(sale.createdAt)} por {sale.createdByName}
          </p>
        </div>
        {props.canVoid && sale.status !== 'VOIDED' && (
          <Button variant="outline" className="text-destructive" onClick={() => setVoiding(true)}>
            <Ban /> Anular venta
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cliente</CardTitle>
        </CardHeader>
        <CardContent>
          {open ? (
            <CustomerPicker
              optional
              value={
                sale.customerId
                  ? { id: sale.customerId, name: sale.customerName ?? 'Cliente', phone: null }
                  : null
              }
              onChange={(c: PickedCustomer | null) =>
                run(() =>
                  api<SaleDetail>(`/v1/sales/${sale.id}/customer`, {
                    method: 'PUT',
                    body: { customerId: c?.id ?? null },
                  }),
                )
              }
            />
          ) : (
            <p>{sale.customerName ?? 'Sin cliente registrado'}</p>
          )}
        </CardContent>
      </Card>

      <Card className="relative overflow-hidden">
        {pending && (
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-primary"
          />
        )}
        <CardHeader>
          <CardTitle className="text-base">Detalle</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {sale.items.length === 0 ? (
            <EmptyState
              icon={ScissorsIcon}
              title="Todavía no hay nada cargado"
              description="Agregá el servicio que se hizo, un producto o una propina y después cobrás."
              className="py-8"
            />
          ) : (
            <ul className="divide-y">
              {sale.items.map((i) => (
                <li
                  key={i.id}
                  className="-mx-2 flex flex-wrap items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-muted/40"
                >
                  <span className="grid">
                    <span className="font-medium">
                      {i.description}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {SALE_ITEM_TYPE_LABELS[i.type]}
                        {i.barberName ? ` · ${i.barberName}` : ''}
                        {i.fromAppointment ? ' · precio reservado' : ''}
                      </span>
                    </span>
                    {i.discountCents > 0 && (
                      <span className="text-xs text-success">
                        Descuento {formatCents(i.discountCents)}
                        {i.discountReason ? ` (${i.discountReason})` : ''}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    {open && i.type === 'PRODUCT' && (
                      <span className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-7"
                          aria-label="Uno menos"
                          disabled={pending || i.quantity <= 1}
                          onClick={() => updateItem(i.id, { quantity: i.quantity - 1 })}
                        >
                          <Minus />
                        </Button>
                        <span className="w-6 text-center tabular-nums">{i.quantity}</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-7"
                          aria-label="Uno más"
                          disabled={pending}
                          onClick={() => updateItem(i.id, { quantity: i.quantity + 1 })}
                        >
                          <Plus />
                        </Button>
                      </span>
                    )}
                    {!open && i.quantity > 1 && <span className="tabular-nums">{i.quantity} ×</span>}
                    <span className="w-24 text-right font-semibold tabular-nums">
                      {formatCents(i.totalCents)}
                    </span>
                    {open && props.canDiscount && i.type !== 'TIP' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label="Descuento"
                        onClick={() => setDiscountFor(i)}
                      >
                        <Percent />
                      </Button>
                    )}
                    {open && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive"
                        aria-label={`Quitar ${i.description}`}
                        disabled={pending}
                        onClick={() =>
                          run(() =>
                            api<SaleDetail>(`/v1/sales/${sale.id}/items/${i.id}`, { method: 'DELETE' }),
                          )
                        }
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {open && (
            <>
              {/* Un toque para lo de siempre: se elige el barbero una vez y se cargan los servicios. */}
              {props.services.length > 0 && props.barbers.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Rápido:</span>
                  {props.barbers.length > 1 && (
                    <Select value={quickBarber} onValueChange={setQuickBarber}>
                      <SelectTrigger size="sm" className="w-36" aria-label="Barbero de los atajos">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {props.barbers.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {props.services.slice(0, 4).map((s) => (
                    <Button
                      key={s.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => addItem({ type: 'SERVICE', serviceId: s.id, barberId: quickBarber })}
                    >
                      <Plus /> {s.name} · {formatCents(s.priceCents)}
                    </Button>
                  ))}
                </div>
              )}
              <AddLines
                products={props.products}
                services={props.services}
                barbers={props.barbers}
                defaultBarber={defaultBarber}
                pending={pending}
                onAdd={addItem}
              />
            </>
          )}

          <LoyaltyPanel sale={sale} onSaleChanged={setSale} />

          {open && !props.cashOpen && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
              <span className="flex items-center gap-2">
                <AlertTriangle className="size-4 shrink-0 text-warning" />
                La caja está cerrada: armá la venta igual, pero para cobrar hay que abrirla.
              </span>
              {props.canOpenCash && (
                <Button asChild size="sm" variant="outline">
                  <Link href="/admin/caja">Abrir la caja</Link>
                </Button>
              )}
            </div>
          )}

          <div className="sticky bottom-0 -mx-6 -mb-6 grid gap-3 border-t bg-card/95 px-6 py-4 backdrop-blur">
            <div className="grid gap-1 text-sm">
              {sale.discountCents > 0 && (
                <>
                  <p className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{formatCents(sale.subtotalCents)}</span>
                  </p>
                  <p className="flex justify-between text-success">
                    <span>Descuentos</span>
                    <span className="tabular-nums">−{formatCents(sale.discountCents)}</span>
                  </p>
                </>
              )}
              <div className="flex items-end justify-between gap-3">
                <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Total
                </span>
                <span className="stat-value text-3xl">{formatCents(sale.totalCents)}</span>
              </div>
            </div>

              {open &&
            (sale.remainingCents > 0 || sale.items.length === 0 ? (
              <PayDialog sale={sale} terminals={props.terminals} onPaid={finish} />
            ) : (
              <Button
                size="lg"
                className="w-full sm:w-auto sm:justify-self-end"
                disabled={pending || sale.items.length === 0}
                onClick={() =>
                  startTransition(async () => {
                    try {
                      finish(await api<SaleDetail>(`/v1/sales/${sale.id}/pay`, { body: { payments: [] } }));
                    } catch (e) {
                      toast.error(e instanceof ApiClientError ? e.message : 'No se pudo cerrar la venta.');
                    }
                  })
                }
              >
                <Wallet /> Cerrar venta (la pagó con puntos)
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {sale.payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cobros</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">
              {sale.payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-3">
                  <span>
                    {PAYMENT_METHOD_LABELS[p.method]}
                    {p.reference ? ` · ${p.reference}` : ''}
                    <span className="text-xs text-muted-foreground">
                      {' '}
                      · {formatDateTime(p.createdAt)} · {p.receivedByName}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={`tabular-nums ${p.status === 'REFUNDED' ? 'text-muted-foreground line-through' : ''}`}
                    >
                      {formatCents(p.amountCents)}
                    </span>
                    {p.refundedCents > 0 && p.status !== 'REFUNDED' && (
                      <span className="text-xs text-muted-foreground">
                        (devuelto {formatCents(p.refundedCents)})
                      </span>
                    )}
                    {props.canRefund && p.status !== 'REFUNDED' && p.amountCents > p.refundedCents && (
                      <Button variant="ghost" size="sm" onClick={() => setRefunding(p)}>
                        <Undo2 /> Devolver
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {sale.status === 'VOIDED' && (
              <p className="mt-3 text-sm text-destructive">
                Anulada el {formatDateTime(sale.voidedAt!)}: {sale.voidReason}. Se reintegró{' '}
                {formatCents(sale.refundedCents)}.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {discountFor && (
        <DiscountDialog
          item={discountFor}
          onClose={() => setDiscountFor(null)}
          onSave={(body) => {
            updateItem(discountFor.id, body);
            setDiscountFor(null);
          }}
        />
      )}
      {refunding && (
        <RefundDialog
          payment={refunding}
          hasCustomer={!!sale.customerId}
          onClose={() => setRefunding(null)}
          onDone={async () => {
            setRefunding(null);
            setSale(await api<SaleDetail>(`/v1/sales/${sale.id}`));
            toast.success('Reintegro registrado.');
            router.refresh();
          }}
        />
      )}
      {voiding && (
        <VoidDialog
          sale={sale}
          onClose={() => setVoiding(false)}
          onVoided={(s) => {
            setSale(s);
            setVoiding(false);
            toast.success('Venta anulada.');
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function AddLines(props: {
  products: Option[];
  services: Option[];
  barbers: { id: string; displayName: string }[];
  defaultBarber: string;
  pending: boolean;
  onAdd: (body: object) => void;
}) {
  const [kind, setKind] = useState<'PRODUCT' | 'SERVICE' | 'TIP'>('PRODUCT');
  const [itemId, setItemId] = useState('');
  const [barberId, setBarberId] = useState(props.defaultBarber);
  const [tip, setTip] = useState<number | null>(null);

  function add() {
    if (kind === 'PRODUCT')
      props.onAdd({ type: 'PRODUCT', productId: itemId, quantity: 1, barberId: barberId || null });
    if (kind === 'SERVICE') props.onAdd({ type: 'SERVICE', serviceId: itemId, barberId });
    if (kind === 'TIP') props.onAdd({ type: 'TIP', barberId, amountCents: tip ?? 0 });
    setItemId('');
    setTip(null);
  }

  const options = kind === 'PRODUCT' ? props.products : props.services;
  const ready = kind === 'TIP' ? !!tip && !!barberId : !!itemId && (kind === 'PRODUCT' || !!barberId);

  return (
    <div className="grid gap-2 rounded-lg border border-dashed p-3 sm:grid-cols-[auto_1fr_10rem_auto] sm:items-end">
      <div className="grid gap-1.5">
        <Label className="text-xs">Agregar</Label>
        <Select
          value={kind}
          onValueChange={(v) => {
            setKind(v as typeof kind);
            setItemId('');
          }}
        >
          <SelectTrigger className="w-full sm:w-32" aria-label="Tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PRODUCT">Producto</SelectItem>
            <SelectItem value="SERVICE">Servicio</SelectItem>
            <SelectItem value="TIP">Propina</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {kind === 'TIP' ? (
        <div className="grid gap-1.5">
          <Label className="text-xs" htmlFor="tip">
            Monto (queda para la casa)
          </Label>
          <MoneyInput id="tip" value={tip} onChange={setTip} />
        </div>
      ) : (
        <div className="grid gap-1.5">
          <Label className="text-xs">{kind === 'PRODUCT' ? 'Producto' : 'Servicio'}</Label>
          <Select value={itemId} onValueChange={setItemId}>
            <SelectTrigger className="w-full" aria-label={kind === 'PRODUCT' ? 'Producto' : 'Servicio'}>
              <SelectValue placeholder="Elegí" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name} · {formatCents(o.priceCents)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label className="text-xs">{kind === 'PRODUCT' ? 'Vendió (comisión)' : 'Barbero'}</Label>
        <Select value={barberId || 'none'} onValueChange={(v) => setBarberId(v === 'none' ? '' : v)}>
          <SelectTrigger className="w-full" aria-label="Barbero">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kind === 'PRODUCT' && <SelectItem value="none">Nadie</SelectItem>}
            {props.barbers.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="button" variant="outline" disabled={!ready || props.pending} onClick={add}>
        <Plus /> Agregar
      </Button>
    </div>
  );
}

function DiscountDialog(props: {
  item: SaleItemDto;
  onClose: () => void;
  onSave: (body: { discountCents: number; discountReason: string | null }) => void;
}) {
  const gross = props.item.unitPriceCents * props.item.quantity;
  const [amount, setAmount] = useState<number | null>(props.item.discountCents || null);
  const [reason, setReason] = useState(props.item.discountReason ?? '');
  const tooMuch = (amount ?? 0) > gross;
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Descuento: {props.item.description}</DialogTitle>
          <DialogDescription>
            Precio {formatCents(gross)}. Queda registrado con tu nombre y el motivo.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            {[10, 20, 50, 100].map((pct) => (
              <Button
                key={pct}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAmount(Math.floor((gross * pct) / 100))}
              >
                {pct} %
              </Button>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="disc">Monto a descontar</Label>
            <MoneyInput id="disc" value={amount} onChange={setAmount} aria-invalid={tooMuch} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="disc-reason">Motivo</Label>
            <Input
              id="disc-reason"
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej.: cliente frecuente"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onSave({ discountCents: 0, discountReason: null })}>
            Sin descuento
          </Button>
          <Button
            disabled={tooMuch || !amount || !reason.trim()}
            onClick={() => props.onSave({ discountCents: amount ?? 0, discountReason: reason.trim() })}
          >
            Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog(props: { sale: SaleDetail; onClose: () => void; onVoided: (s: SaleDetail) => void }) {
  const [reason, setReason] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  function confirm() {
    startTransition(async () => {
      try {
        props.onVoided(
          await api<SaleDetail>(`/v1/sales/${props.sale.id}/void`, { body: { reason }, idempotencyKey: key }),
        );
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo anular.');
      }
    });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>¿Anular la venta #{props.sale.number}?</DialogTitle>
          <DialogDescription>
            {props.sale.status === 'PAID'
              ? `Se reintegra ${formatCents(props.sale.paidCents)} (el efectivo sale de la caja abierta), se revierten las comisiones y vuelve el stock. No se borra nada: queda todo registrado.`
              : 'La venta todavía no se cobró: solo queda anulada.'}
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
          <Button variant="outline" onClick={props.onClose}>
            Volver
          </Button>
          <Button variant="destructive" disabled={reason.trim().length < 3 || pending} onClick={confirm}>
            Anular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Devolver plata de un cobro. Solo el dueño (decisión del 28/09/2026). */
function RefundDialog(props: {
  payment: SaleDetail['payments'][number];
  hasCustomer: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const available = props.payment.amountCents - props.payment.refundedCents;
  const [amount, setAmount] = useState<number | null>(available);
  const [reason, setReason] = useState('');
  const [destination, setDestination] = useState<'ORIGINAL_METHOD' | 'CUSTOMER_CREDIT'>('ORIGINAL_METHOD');
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await api(`/v1/payments/${props.payment.id}/refunds`, {
          body: { amountCents: amount, reason: reason.trim(), destination },
          idempotencyKey: key,
        });
        props.onDone();
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo devolver.');
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Devolver {PAYMENT_METHOD_LABELS[props.payment.method]}</DialogTitle>
          <DialogDescription>De este cobro quedan {formatCents(available)} para devolver.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="rf-amount">Monto</Label>
            <MoneyInput id="rf-amount" value={amount} onChange={setAmount} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rf-dest">¿A dónde va?</Label>
            <Select value={destination} onValueChange={(v) => setDestination(v as typeof destination)}>
              <SelectTrigger id="rf-dest" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ORIGINAL_METHOD">Al medio original</SelectItem>
                <SelectItem value="CUSTOMER_CREDIT" disabled={!props.hasCustomer}>
                  Saldo a favor del cliente
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rf-reason">Motivo</Label>
            <Input
              id="rf-reason"
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Volver
          </Button>
          <Button
            variant="destructive"
            disabled={!amount || reason.trim().length < 3 || pending}
            onClick={submit}
          >
            {pending ? 'Devolviendo…' : 'Devolver'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
