'use client';

import {
  ACCESS_TYPES,
  MARKETING_TYPES,
  NOTIFICATION_TYPE_LABELS,
  TEMPLATE_VARIABLES,
  minutesToTime,
  timeToMinutes,
  type NotificationSettings,
  type NotificationType,
} from '@estoicos/shared';
import { MessageCircle, Moon } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api, ApiClientError } from '@/lib/api/client';
import { formatDuration } from '@/lib/format';

/** Configuración de notificaciones: canales, horarios y plantillas de WhatsApp. */
export function NotificationSettingsForm({ initial }: { initial: NotificationSettings }) {
  const [settings, setSettings] = useState(initial);
  const [pending, startTransition] = useTransition();

  function save(body: object, success: string) {
    startTransition(async () => {
      try {
        setSettings(await api<NotificationSettings>('/v1/notifications/settings', { method: 'PATCH', body }));
        toast.success(success);
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo guardar.');
      }
    });
  }

  function saveType(type: NotificationType, body: object, success: string) {
    startTransition(async () => {
      try {
        setSettings(
          await api<NotificationSettings>(`/v1/notifications/types/${type}`, { method: 'PATCH', body }),
        );
        toast.success(success);
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo guardar.');
      }
    });
  }

  const visible = settings.types.filter((t) => !ACCESS_TYPES.includes(t.type));

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageCircle className="size-5" /> WhatsApp
          </CardTitle>
          <CardDescription>
            Meta solo deja iniciar conversaciones con <strong>plantillas aprobadas</strong>. El mensaje que no
            tenga plantilla cargada sale por email, y si WhatsApp falla, también.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {!settings.whatsappConfigured && (
            <p className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
              Todavía no está cargado el número de WhatsApp en el servidor. Mientras tanto, todo sale por
              email y funciona igual.
            </p>
          )}
          <label className="flex items-center gap-3 text-sm">
            <Switch
              checked={settings.whatsappEnabled}
              disabled={pending || !settings.whatsappConfigured}
              onCheckedChange={(on) =>
                save(
                  { whatsappEnabled: on },
                  on ? 'WhatsApp activado.' : 'WhatsApp apagado: todo sale por email.',
                )
              }
            />
            Mandar por WhatsApp cuando se pueda
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Cuándo se manda cada cosa</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Recordatorios del turno</Label>
            <p className="text-sm text-muted-foreground">
              {settings.reminderOffsetsMinutes.map((m) => formatDuration(m)).join(' y ')} antes.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="review-delay">Pedido de reseña, después del corte</Label>
            <Input
              id="review-delay"
              type="number"
              min={5}
              max={1440}
              className="w-28"
              defaultValue={settings.reviewRequestDelayMinutes}
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (value && value !== settings.reviewRequestDelayMinutes) {
                  save({ reviewRequestDelayMinutes: value }, 'Guardado.');
                }
              }}
            />
            <span className="text-xs text-muted-foreground">minutos</span>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="reactivation-days">Reactivación, sin venir hace</Label>
            <Input
              id="reactivation-days"
              type="number"
              min={7}
              max={365}
              className="w-28"
              defaultValue={settings.reactivationAfterDays}
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (value && value !== settings.reactivationAfterDays) {
                  save({ reactivationAfterDays: value }, 'Guardado.');
                }
              }}
            />
            <span className="text-xs text-muted-foreground">días</span>
          </div>
          <div className="grid gap-1.5">
            <Label className="flex items-center gap-1.5">
              <Moon className="size-4" /> Sin promociones entre
            </Label>
            <div className="flex items-center gap-2">
              <Input
                type="time"
                aria-label="Desde"
                className="w-28"
                defaultValue={minutesToTime(settings.marketingQuietStartMinute)}
                onBlur={(e) => {
                  const value = timeToMinutes(e.target.value);
                  if (value !== null && value !== settings.marketingQuietStartMinute) {
                    save({ marketingQuietStartMinute: value }, 'Guardado.');
                  }
                }}
              />
              <span className="text-sm text-muted-foreground">y</span>
              <Input
                type="time"
                aria-label="Hasta"
                className="w-28"
                defaultValue={minutesToTime(settings.marketingQuietEndMinute)}
                onBlur={(e) => {
                  const value = timeToMinutes(e.target.value);
                  if (value !== null && value !== settings.marketingQuietEndMinute) {
                    save({ marketingQuietEndMinute: value }, 'Guardado.');
                  }
                }}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              Los avisos de turnos salen igual a cualquier hora.
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Mensajes</CardTitle>
          <CardDescription>
            El nombre de la plantilla es el que le pusiste en Meta. Las variables van en este orden.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {visible.map((t) => (
              <li key={t.type} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-start">
                <div className="grid gap-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {NOTIFICATION_TYPE_LABELS[t.type]}
                    {MARKETING_TYPES.includes(t.type) && <Badge variant="outline">Promoción</Badge>}
                    {!t.whatsappTemplateName && <Badge variant="secondary">Solo email</Badge>}
                  </span>
                  {TEMPLATE_VARIABLES[t.type] && (
                    <span className="text-xs text-muted-foreground">
                      Variables: {TEMPLATE_VARIABLES[t.type]!.map((v, i) => `{{${i + 1}}} ${v}`).join(' · ')}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label={`Plantilla de ${NOTIFICATION_TYPE_LABELS[t.type]}`}
                    placeholder="Plantilla de WhatsApp"
                    className="w-52"
                    defaultValue={t.whatsappTemplateName ?? ''}
                    onBlur={(e) => {
                      if (e.target.value !== (t.whatsappTemplateName ?? '')) {
                        saveType(
                          t.type,
                          { whatsappTemplateName: e.target.value || null },
                          'Plantilla guardada.',
                        );
                      }
                    }}
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={t.enabled}
                      disabled={pending}
                      onCheckedChange={(on) =>
                        saveType(t.type, { enabled: on }, on ? 'Mensaje activado.' : 'Mensaje apagado.')
                      }
                    />
                    Activo
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
