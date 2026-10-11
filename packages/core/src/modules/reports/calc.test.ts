import { describe, expect, it } from 'vitest';
import {
  averageTicketCents,
  changeBps,
  csvCell,
  csvMoney,
  daysBetween,
  exportFileName,
  occupancyBps,
  splitNewReturning,
  toCsv,
} from './calc';

describe('ocupación', () => {
  it('cuatro horas reservadas sobre ocho es 50 %', () => {
    expect(occupancyBps(240, 480)).toBe(5000);
  });

  it('un barbero que no trabajó ese día no está 100 % ocupado ni rompe la cuenta', () => {
    expect(occupancyBps(0, 0)).toBe(0);
    expect(occupancyBps(60, 0)).toBe(0);
  });

  it('redondea al punto básico más cercano', () => {
    expect(occupancyBps(100, 480)).toBe(2083);
  });
});

describe('ticket promedio', () => {
  it('reparte el total entre las ventas', () => {
    expect(averageTicketCents(4_500_000n, 3)).toBe(1_500_000n);
  });

  it('sin ventas da 0 y no explota', () => {
    expect(averageTicketCents(0n, 0)).toBe(0n);
  });
});

describe('comparación con el período anterior', () => {
  it('de $100 a $150 es +50 %', () => {
    expect(changeBps(15_000_000n, 10_000_000n)).toBe(5000);
  });

  it('caer a la mitad es −50 %', () => {
    expect(changeBps(5_000_000n, 10_000_000n)).toBe(-5000);
  });

  it('si antes no hubo nada, no hay porcentaje que mostrar', () => {
    expect(changeBps(10_000n, 0n)).toBeNull();
  });
});

describe('días del rango', () => {
  it('incluye los dos extremos', () => {
    expect(daysBetween('2026-09-28', '2026-10-01')).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
    ]);
  });

  it('un solo día es un solo día', () => {
    expect(daysBetween('2026-09-28', '2026-09-28')).toEqual(['2026-09-28']);
  });

  it('un rango absurdo se corta en vez de colgar el servidor', () => {
    expect(daysBetween('2020-01-01', '2030-01-01').length).toBe(401);
  });
});

describe('nuevos vs. recurrentes', () => {
  const from = new Date('2026-09-01T03:00:00Z');
  const to = new Date('2026-10-01T03:00:00Z');

  it('es nuevo el que vino por primera vez en el período', () => {
    const r = splitNewReturning(
      [
        { customerId: 'a', firstVisitAt: new Date('2026-09-10T15:00:00Z') },
        { customerId: 'b', firstVisitAt: new Date('2026-01-05T15:00:00Z') },
      ],
      from,
      to,
    );
    expect(r).toEqual({ newOnes: 1, returning: 1 });
  });

  it('el que vino tres veces en el mes cuenta una sola vez', () => {
    const visits = [1, 2, 3].map(() => ({ customerId: 'a', firstVisitAt: new Date('2026-09-02T15:00:00Z') }));
    expect(splitNewReturning(visits, from, to)).toEqual({ newOnes: 1, returning: 0 });
  });

  it('el que todavía no tiene primera visita registrada cuenta como recurrente, no como nuevo', () => {
    expect(splitNewReturning([{ customerId: 'a', firstVisitAt: null }], from, to)).toEqual({
      newOnes: 0,
      returning: 1,
    });
  });
});

describe('CSV para Excel en español', () => {
  it('encierra entre comillas lo que lleva punto y coma, comillas o saltos de línea', () => {
    expect(csvCell('Corte; barba')).toBe('"Corte; barba"');
    expect(csvCell('Dijo "hola"')).toBe('"Dijo ""hola"""');
    expect(csvCell('dos\nlíneas')).toBe('"dos\nlíneas"');
  });

  it('neutraliza las fórmulas: una planilla no ejecuta nada', () => {
    expect(csvCell('=SUMA(A1:A9)')).toBe("'=SUMA(A1:A9)");
    expect(csvCell('+1 (11) 5555')).toBe("'+1 (11) 5555");
  });

  it('la plata va con coma decimal', () => {
    expect(csvMoney(1_500_000n)).toBe('15000,00');
    expect(csvMoney(1_234_567n)).toBe('12345,67');
    expect(csvMoney(-50_000n)).toBe('-500,00');
    expect(csvMoney(0n)).toBe('0,00');
  });

  it('el archivo arranca con el BOM y separa con punto y coma', () => {
    const csv = toCsv(['Fecha', 'Total'], [['2026-09-28', csvMoney(1_500_000n)]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Fecha;Total');
    expect(csv).toContain('2026-09-28;15000,00');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('el nombre del archivo dice qué es y de cuándo', () => {
    expect(exportFileName('ventas', '2026-09-01', '2026-09-30')).toBe(
      'estoicos-ventas-2026-09-01-a-2026-09-30.csv',
    );
  });
});
