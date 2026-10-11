'use client';

import { MP_ACCOUNT_STATUS_LABELS, type MpAccountDto } from '@estoicos/shared';
import { AlertTriangle, CheckCircle2, Link2, Unlink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
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
import { api, ApiClientError } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format';

/**
 * Vinculación de la cuenta. El dueño pega el Access Token y la clave de webhooks de SU
 * aplicación de Mercado Pago: se guardan cifrados y nunca se vuelven a mostrar.
 */
export function ConnectAccount({
  account,
  canConnect,
}: {
  account: MpAccountDto | null;
  canConnect: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!account) {
    return (
      <Card className="border-primary/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Link2 className="size-5" /> Vincular Mercado Pago
          </CardTitle>
          <CardDescription>
            Mientras no esté vinculado, se cobra igual: el Point se carga a mano como “Point Mercado Pago”.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Steps />
          {canConnect ? (
            <Button className="w-fit" onClick={() => setOpen(true)}>
              <Link2 /> Vincular cuenta
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">La vinculación la hace el dueño.</p>
          )}
        </CardContent>
        {open && <ConnectDialog onClose={() => setOpen(false)} />}
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            {account.status === 'ACTIVE' ? (
              <CheckCircle2 className="size-5 text-success" />
            ) : (
              <AlertTriangle className="size-5 text-warning" />
            )}
            {account.label}
            <Badge variant={account.status === 'ACTIVE' ? 'secondary' : 'destructive'}>
              {MP_ACCOUNT_STATUS_LABELS[account.status]}
            </Badge>
            {!account.liveMode && <Badge variant="outline">Credenciales de prueba</Badge>}
          </CardTitle>
          <CardDescription>
            {account.nickname ? `${account.nickname} · ` : ''}Vinculada el{' '}
            {formatDateTime(account.connectedAt)} · {account.terminalCount}{' '}
            {account.terminalCount === 1 ? 'terminal' : 'terminales'}
          </CardDescription>
        </div>
        {canConnect && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              Cambiar credenciales
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setDisconnecting(true)}
            >
              <Unlink /> Desvincular
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="grid gap-3">
        {!account.hasWebhookSecret && (
          <p className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
            Falta la <strong>clave secreta de webhooks</strong>. Sin ella, Mercado Pago no nos puede avisar
            cuando el cliente paga y los cobros van a tardar hasta 2 minutos en confirmarse.
          </p>
        )}
        {account.lastError && (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
            Último problema ({formatDateTime(account.lastErrorAt!)}): {account.lastError}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Pagos sincronizados hasta{' '}
          {account.paymentsSyncedUntil
            ? formatDateTime(account.paymentsSyncedUntil)
            : 'todavía no se sincronizó'}
          .
        </p>
      </CardContent>
      {open && <ConnectDialog onClose={() => setOpen(false)} existing />}
      {disconnecting && (
        <Dialog open onOpenChange={(o) => !o && setDisconnecting(false)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>¿Desvincular Mercado Pago?</DialogTitle>
              <DialogDescription>
                Se borra el token guardado y se deja de cobrar con el Point. El historial de pagos queda
                intacto.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDisconnecting(false)}>
                Volver
              </Button>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    try {
                      await api('/v1/mercadopago/account', { method: 'DELETE' });
                      toast.success('Cuenta desvinculada.');
                      setDisconnecting(false);
                      router.refresh();
                    } catch (e) {
                      toast.error(e instanceof ApiClientError ? e.message : 'No se pudo desvincular.');
                    }
                  })
                }
              >
                Desvincular
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

function Steps() {
  return (
    <ol className="grid gap-2 text-sm text-muted-foreground">
      {[
        'Entrá a Mercado Pago → Tu negocio → Configuraciones → Gestión y administración → Tus integraciones.',
        'Creá una aplicación (o abrí la que ya tengas) y activá las credenciales de producción.',
        'Copiá el Access Token.',
        'En "Webhooks", poné la URL que te mostramos abajo, marcá los temas "Order (Mercado Pago)" y "Pagos", y copiá la clave secreta.',
      ].map((text, i) => (
        <li key={text} className="flex gap-2">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold text-foreground">
            {i + 1}
          </span>
          {text}
        </li>
      ))}
    </ol>
  );
}

function ConnectDialog({ onClose, existing }: { onClose: () => void; existing?: boolean }) {
  const router = useRouter();
  const [label, setLabel] = useState('Cuenta de la barbería');
  const [accessToken, setAccessToken] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const webhookUrl =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin.replace('://', '://api.')}/webhooks/mercadopago`;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await api('/v1/mercadopago/account', {
          body: { label, accessToken: accessToken.trim(), webhookSecret: webhookSecret.trim() || null },
        });
        toast.success('Cuenta vinculada. Ahora traé las terminales.');
        onClose();
        router.refresh();
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : 'No se pudo vincular.');
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? 'Cambiar credenciales' : 'Vincular Mercado Pago'}</DialogTitle>
          <DialogDescription>
            Se guardan cifradas y no se vuelven a mostrar. Si algún día se filtran, se revocan desde Mercado
            Pago.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="mp-label">Nombre</Label>
            <Input id="mp-label" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mp-token">Access Token</Label>
            <Input
              id="mp-token"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="APP_USR-… (o TEST-… para probar)"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mp-secret">Clave secreta de webhooks</Label>
            <Input
              id="mp-secret"
              autoComplete="off"
              spellCheck={false}
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              URL para pegar en Mercado Pago: <code className="break-all">{webhookUrl}</code>
            </p>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || accessToken.trim().length < 20}>
              {pending ? 'Probando el token…' : 'Vincular'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
