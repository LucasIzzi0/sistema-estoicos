'use client';

import type { LoyaltySettings } from '@estoicos/shared';
import { Gift } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { MoneyInput } from '@/components/form/money-input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { api, ApiClientError } from '@/lib/api/client';
import { formatCents } from '@/lib/format';

const NEVER = 'never';

/** Reglas del programa: cuánto suma el cliente, cuándo vence y qué pasa con la comisión. */
export function LoyaltySettingsForm({ initial }: { initial: LoyaltySettings }) {
  const [settings, setSettings] = useState(initial);
  const [pending, startTransition] = useTransition();

  function save(body: object, success: string) {
    startTransition(async () => {
      try {
        setSettings(await api<LoyaltySettings>('/v1/loyalty/settings', { method: 'PATCH', body }));
        toast.success(success);
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo guardar.');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Gift className="size-5" /> Cómo suma puntos el cliente
        </CardTitle>
        <CardDescription>
          Hoy: <strong>{settings.pointsPerStep} punto</strong> cada {formatCents(settings.spendStepCents)} de
          gasto. Las propinas nunca suman.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="grid gap-0.5">
            <span className="font-medium">Programa de puntos activo</span>
            <span className="text-muted-foreground">
              Apagarlo no borra nada: deja de sumar y de poder canjear.
            </span>
          </span>
          <Switch
            checked={settings.enabled}
            disabled={pending}
            onCheckedChange={(on) =>
              save({ enabled: on }, on ? 'Programa activado.' : 'Programa apagado.')
            }
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="points-per-step">Puntos que suma</Label>
            <Input
              id="points-per-step"
              inputMode="numeric"
              className="w-24"
              defaultValue={settings.pointsPerStep}
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (value > 0 && value !== settings.pointsPerStep) save({ pointsPerStep: value }, 'Guardado.');
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="spend-step">Cada cuánto gasto</Label>
            <MoneyInput
              id="spend-step"
              value={settings.spendStepCents}
              onChange={(value) => {
                if (value && value !== settings.spendStepCents) save({ spendStepCents: value }, 'Guardado.');
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="expiry">Los puntos vencen</Label>
            <Select
              value={settings.expiryMonths === null ? NEVER : String(settings.expiryMonths)}
              onValueChange={(v) =>
                save(
                  { expiryMonths: v === NEVER ? null : Number(v) },
                  v === NEVER ? 'Los puntos no vencen más.' : 'Guardado.',
                )
              }
            >
              <SelectTrigger id="expiry" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[6, 12, 18, 24].map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    A los {m} meses
                  </SelectItem>
                ))}
                <SelectItem value={NEVER}>Nunca</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="commission-base">Si paga con puntos, la comisión del barbero va sobre</Label>
            <Select
              value={settings.rewardCommissionBase}
              onValueChange={(v) =>
                save({ rewardCommissionBase: v }, 'Guardado.')
              }
            >
              <SelectTrigger id="commission-base" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LIST_PRICE">El precio de lista (el barbero no pierde)</SelectItem>
                <SelectItem value="CHARGED_AMOUNT">Lo que pagó el cliente</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="grid gap-0.5">
            <span className="font-medium">Los productos también suman puntos</span>
            <span className="text-muted-foreground">Ceras, shampoos y demás.</span>
          </span>
          <Switch
            checked={settings.earnOnProducts}
            disabled={pending}
            onCheckedChange={(on) =>
              save({ earnOnProducts: on }, on ? 'Los productos suman.' : 'Los productos no suman más.')
            }
          />
        </label>
      </CardContent>
    </Card>
  );
}
