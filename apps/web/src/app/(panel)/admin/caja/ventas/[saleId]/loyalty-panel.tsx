'use client';

import type { SaleDetail, SaleLoyalty } from '@estoicos/shared';
import { Gift, Undo2 } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';

/**
 * Canje de puntos en el cobro. El saldo y a qué línea aplica cada recompensa los decide la API:
 * acá solo se muestra y se pide. Después de canjear se relee la venta (cambió el total).
 */
export function LoyaltyPanel({
  sale,
  onSaleChanged,
}: {
  sale: SaleDetail;
  onSaleChanged: (s: SaleDetail) => void;
}) {
  const [loyalty, setLoyalty] = useState<SaleLoyalty | null>(null);
  const [pending, startTransition] = useTransition();
  const open = sale.status === 'OPEN';
  // Al cambiar las líneas cambia lo que se puede canjear: se vuelve a preguntar.
  const signature = sale.items.map((i) => `${i.id}:${i.totalCents}`).join('|');

  useEffect(() => {
    let alive = true;
    api<SaleLoyalty>(`/v1/sales/${sale.id}/loyalty`)
      .then((data) => alive && setLoyalty(data))
      .catch(() => alive && setLoyalty(null));
    return () => {
      alive = false;
    };
  }, [sale.id, signature]);

  function run(action: () => Promise<SaleLoyalty>, success: string) {
    startTransition(async () => {
      try {
        setLoyalty(await action());
        onSaleChanged(await api<SaleDetail>(`/v1/sales/${sale.id}`));
        toast.success(success);
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo canjear.');
      }
    });
  }

  if (!loyalty || !loyalty.customerId) return null;
  const canRedeem = loyalty.rewards.filter((r) => r.affordable && r.applicableItemIds.length > 0);
  if (!open && loyalty.redemptions.length === 0) return null;

  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Gift className="size-4" /> Puntos del cliente
        </span>
        <Badge variant="secondary" className="tabular-nums">
          {loyalty.balance} disponibles
        </Badge>
      </div>

      {loyalty.redemptions.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            Canjeó <strong>{r.rewardName}</strong> por {r.pointsSpent} puntos
          </span>
          {open && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () => api<SaleLoyalty>(`/v1/sales/${sale.id}/loyalty/${r.id}`, { method: 'DELETE' }),
                  'Canje deshecho: le devolvimos los puntos.',
                )
              }
            >
              <Undo2 /> Deshacer
            </Button>
          )}
        </div>
      ))}

      {open &&
        (canRedeem.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {canRedeem.map((r) => (
              <Button
                key={r.id}
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(
                    () =>
                      api<SaleLoyalty>(`/v1/sales/${sale.id}/loyalty/redeem`, { body: { rewardId: r.id } }),
                    `${r.name} canjeado.`,
                  )
                }
              >
                {r.name} · {r.pointsCost} pts
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {loyalty.rewards.length === 0
              ? 'No hay recompensas cargadas.'
              : loyalty.rewards.some((r) => r.affordable)
                ? 'Le alcanzan los puntos, pero no hay línea de esta venta donde aplicar sus recompensas.'
                : 'Todavía no le alcanza para ninguna recompensa.'}
          </p>
        ))}
    </div>
  );
}
