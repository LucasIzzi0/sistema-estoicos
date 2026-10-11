import { POINTS_ENTRY_LABELS, type MyPoints } from '@estoicos/shared';
import { Gift, Lock, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { serverApi } from '@/lib/api/server';
import { formatDate, formatDateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Mis puntos' };

/** "Mis puntos": saldo, qué puede pedir y cuánto le falta para lo que sigue. */
export default async function MyPointsPage() {
  const { data } = await serverApi<MyPoints>('/v1/me/points');
  const points: MyPoints = data ?? {
    enabled: false,
    balance: 0,
    expiringSoon: 0,
    expiringOn: null,
    entries: [],
    rewards: [],
  };
  const next = points.rewards.find((r) => !r.affordable) ?? null;

  return (
    <div className="grid gap-6">
      <h1 className="text-3xl font-extrabold uppercase text-gold">Mis puntos</h1>

      {!points.enabled ? (
        <EmptyState
          icon={Gift}
          title="El programa de puntos está apagado"
          description="Cuando la barbería lo active, cada compra te va a sumar puntos para canjear."
        />
      ) : (
        <>
          <div className="grid gap-2 rounded-xl border bg-card p-6 text-center">
            <span className="font-heading text-5xl font-bold tabular-nums">{points.balance}</span>
            <span className="text-sm text-muted-foreground">
              {points.balance === 1 ? 'punto disponible' : 'puntos disponibles'}
            </span>
            {points.expiringSoon > 0 && points.expiringOn && (
              <span className="text-sm text-warning">
                Se te vencen {points.expiringSoon} el {formatDate(points.expiringOn)}: usalos antes.
              </span>
            )}
            {next && (
              <span className="text-sm text-muted-foreground">
                Te faltan <strong>{next.missingPoints}</strong> para {next.name}.
              </span>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Gift className="size-5" /> Qué podés pedir
              </CardTitle>
            </CardHeader>
            <CardContent>
              {points.rewards.length === 0 ? (
                <p className="text-sm text-muted-foreground">Todavía no hay recompensas cargadas.</p>
              ) : (
                <ul className="divide-y">
                  {points.rewards.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <span className="grid">
                        <span className="font-medium">{r.name}</span>
                        {r.description && (
                          <span className="text-sm text-muted-foreground">{r.description}</span>
                        )}
                      </span>
                      {r.affordable ? (
                        <Badge>Lo podés pedir · {r.pointsCost} puntos</Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <Lock className="size-3" />
                          Te faltan {r.missingPoints}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="pt-3 text-xs text-muted-foreground">
                Se canjean en el local: avisale al que te cobra y te lo descuenta ahí mismo.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Movimientos</CardTitle>
            </CardHeader>
            <CardContent>
              {points.entries.length === 0 ? (
                <EmptyState
                  icon={Sparkles}
                  title="Todavía no tenés movimientos"
                  description="Empezás a sumar en tu próximo corte: 1 punto por cada $1.000."
                  className="py-8"
                />
              ) : (
                <ul className="divide-y text-sm">
                  {points.entries.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                      <span className="grid">
                        <span className="font-medium">
                          {e.type === 'REDEEM' && e.reason ? e.reason : POINTS_ENTRY_LABELS[e.type]}
                        </span>
                        <span className="text-muted-foreground">
                          {formatDateTime(e.createdAt)}
                          {e.saleNumber !== null && ` · compra #${e.saleNumber}`}
                        </span>
                      </span>
                      <span
                        className={`font-semibold tabular-nums ${e.points > 0 ? 'text-success' : 'text-muted-foreground'}`}
                      >
                        {e.points > 0 ? `+${e.points}` : e.points}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
