'use client';

import {
  NOTIFICATION_STATUS_LABELS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPE_LABELS,
  type NotificationLogItem,
} from '@estoicos/shared';
import { Inbox, Mail, MessageCircle, RefreshCw } from 'lucide-react';
import { useState, useTransition } from 'react';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format';

const TONE: Partial<
  Record<(typeof NOTIFICATION_STATUSES)[number], 'default' | 'secondary' | 'destructive' | 'outline'>
> = {
  DELIVERED: 'secondary',
  READ: 'secondary',
  SENT: 'secondary',
  FAILED: 'destructive',
  SKIPPED: 'outline',
  PENDING: 'default',
};

/** Registro de envíos: qué se mandó, por dónde, y qué pasó. */
export function NotificationLog({ initial }: { initial: NotificationLogItem[] }) {
  const [rows, setRows] = useState(initial);
  const [status, setStatus] = useState<string>('all');
  const [pending, startTransition] = useTransition();

  function load(nextStatus = status) {
    startTransition(async () => {
      const query = nextStatus === 'all' ? '' : `&status=${nextStatus}`;
      setRows(await api<NotificationLogItem[]>(`/v1/notifications?limit=50${query}`));
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <CardTitle className="text-lg">Envíos</CardTitle>
          <CardDescription>Los últimos 50. “No se envió” muestra el motivo.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              load(v);
            }}
          >
            <SelectTrigger className="w-40" aria-label="Estado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {NOTIFICATION_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {NOTIFICATION_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Actualizar"
            disabled={pending}
            onClick={() => load()}
          >
            <RefreshCw className={pending ? 'animate-spin' : undefined} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Todavía no se envió nada"
            description="Acá aparece cada mensaje que sale, por qué canal fue y qué pasó con él."
          />
        ) : (
          <ul className="divide-y text-sm">
            {rows.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="grid">
                  <span className="flex items-center gap-2 font-medium">
                    {n.channel === 'WHATSAPP' ? (
                      <MessageCircle className="size-4 text-success" />
                    ) : (
                      <Mail className="size-4 text-muted-foreground" />
                    )}
                    {NOTIFICATION_TYPE_LABELS[n.type]}
                    {n.isFallback && <Badge variant="outline">Reemplazo por email</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {n.customerName ?? n.recipient} · {formatDateTime(n.sentAt ?? n.scheduledFor)}
                    {n.skippedReason ? ` · ${n.skippedReason}` : ''}
                    {n.lastError ? ` · ${n.lastError}` : ''}
                    {n.attempts > 1 ? ` · ${n.attempts} intentos` : ''}
                  </span>
                </span>
                <Badge variant={TONE[n.status] ?? 'outline'}>{NOTIFICATION_STATUS_LABELS[n.status]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
