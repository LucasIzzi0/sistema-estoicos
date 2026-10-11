/**
 * Cuentas puras de los reportes (Fase 8). Sin base de datos: se testean solas y siempre dan lo
 * mismo. Los montos son centavos enteros y los porcentajes, puntos básicos (6000 = 60 %).
 */

/** Ocupación de un barbero: minutos reservados sobre minutos que tenía disponibles. */
export function occupancyBps(bookedMinutes: number, availableMinutes: number): number {
  if (availableMinutes <= 0) return 0;
  return Math.round((bookedMinutes / availableMinutes) * 10_000);
}

/** Ticket promedio. Sin ventas es 0, no una división por cero. */
export function averageTicketCents(incomeCents: bigint, salesCount: number): bigint {
  if (salesCount <= 0) return 0n;
  return incomeCents / BigInt(salesCount);
}

/** Cuánto cambió respecto del período anterior, en puntos básicos. `null` si antes no hubo nada. */
export function changeBps(current: bigint, previous: bigint): number | null {
  if (previous === 0n) return null;
  return Number(((current - previous) * 10_000n) / (previous < 0n ? -previous : previous));
}

/** Todos los días del rango, para que el gráfico no saltee los días sin ventas. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = new Date(`${from}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
    // Un rango disparatado no puede colgar el servidor.
    if (days.length > 400) break;
  }
  return days;
}

/**
 * Nuevos vs. recurrentes: es nuevo el que en este período tuvo su **primera** visita.
 * Se decide con la fecha de primera visita del cliente, no con el conteo del período.
 */
export function splitNewReturning(
  visitors: { customerId: string; firstVisitAt: Date | null }[],
  from: Date,
  to: Date,
): { newOnes: number; returning: number } {
  const seen = new Map<string, Date | null>();
  for (const v of visitors) if (!seen.has(v.customerId)) seen.set(v.customerId, v.firstVisitAt);
  let newOnes = 0;
  for (const first of seen.values()) {
    if (first && first >= from && first < to) newOnes += 1;
  }
  return { newOnes, returning: seen.size - newOnes };
}

// ---------------------------------------------------------------------------
// CSV para Excel en español
// ---------------------------------------------------------------------------

/**
 * Excel en español usa **punto y coma** como separador y **coma** decimal. Además necesita el
 * BOM para entender los acentos. Sin esto, la planilla se abre toda en una columna y con símbolos
 * raros, que es exactamente lo que hace que nadie use el export.
 */
const SEPARATOR = ';';
const BOM = '﻿';

/** Escapa una celda. Una fórmula (=, +, -, @) se neutraliza: un CSV no debe ejecutar nada. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/["\n\r;]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

/** Centavos → "15000,00", como lo espera una planilla en español. */
export function csvMoney(cents: bigint | number): string {
  const value = typeof cents === 'bigint' ? cents : BigInt(Math.round(cents));
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? '-' : ''}${abs / 100n},${String(abs % 100n).padStart(2, '0')}`;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(csvCell).join(SEPARATOR)];
  for (const row of rows) lines.push(row.map(csvCell).join(SEPARATOR));
  // CRLF: es lo que esperan Excel y el estándar del formato.
  return BOM + lines.join('\r\n') + '\r\n';
}

/** Nombre del archivo que baja: `estoicos-ventas-2026-09-01-a-2026-09-30.csv`. */
export function exportFileName(kind: string, from: string, to: string): string {
  return `estoicos-${kind}-${from}-a-${to}.csv`;
}
