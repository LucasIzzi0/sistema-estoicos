import { describe, expect, it } from 'vitest';
import { applyPercentChange } from './pricing';
import { findOverlap, minutesToTime, timeToMinutes, validateWeeklySchedule } from './schedule';
import { customerSearchText, normalizeSearchText, searchTerms } from './search';

describe('horarios', () => {
  it('convierte horas', () => {
    expect(minutesToTime(630)).toBe('10:30');
    expect(timeToMinutes('10:30')).toBe(630);
    expect(timeToMinutes('24:00')).toBe(1440);
    expect(timeToMinutes('25:00')).toBeNull();
  });
  it('acepta un turno partido y rechaza tramos que se pisan', () => {
    expect(
      validateWeeklySchedule([
        { weekday: 2, startMinute: 600, endMinute: 840 },
        { weekday: 2, startMinute: 900, endMinute: 1200 },
      ]),
    ).toBeNull();
    expect(
      validateWeeklySchedule([
        { weekday: 2, startMinute: 600, endMinute: 900 },
        { weekday: 2, startMinute: 840, endMinute: 1200 },
      ]),
    ).toMatch(/Martes: los tramos 10:00–15:00 y 14:00–20:00 se pisan/);
  });
  it('tramos contiguos no se pisan', () => {
    expect(
      findOverlap(
        [{ weekday: 3, startMinute: 600, endMinute: 840 }],
        [{ weekday: 3, startMinute: 840, endMinute: 900 }],
      ),
    ).toBeNull();
  });
  it('rechaza horarios invertidos y fuera de 5 minutos', () => {
    expect(validateWeeklySchedule([{ weekday: 1, startMinute: 900, endMinute: 600 }])).toMatch(/posterior/);
    expect(validateWeeklySchedule([{ weekday: 1, startMinute: 601, endMinute: 900 }])).toMatch(/5 en 5/);
  });
});

describe('aumento de precios', () => {
  it('aplica el porcentaje y redondea', () => {
    expect(applyPercentChange(1_500_000, 1_200, 10_000)).toBe(1_680_000); // $15.000 +12 % → $16.800
    expect(applyPercentChange(1_234_500, 1_000, 50_000)).toBe(1_350_000); // → $13.579,50 → $13.500
    expect(applyPercentChange(900_000, -500, 100)).toBe(855_000);
  });
});

describe('búsqueda', () => {
  it('ignora acentos y mayúsculas', () => {
    expect(normalizeSearchText('  Martín   GÓMEZ ')).toBe('martin gomez');
  });
  it('arma el texto buscable del cliente', () => {
    expect(
      customerSearchText({
        firstName: 'Martín',
        lastName: 'Gómez',
        email: 'M@x.com',
        phone: '+5491122334455',
        dni: '30111222',
      }),
    ).toBe('martin gomez m@x.com 5491122334455 30111222');
  });
  it('un teléfono se busca por sus últimos 8 dígitos', () => {
    expect(searchTerms('011 15 2233-4455')).toEqual(['22334455']);
    expect(searchTerms('30.111.222')).toEqual(['30111222']);
    expect(searchTerms('Martín Gó')).toEqual(['martin', 'go']);
  });
});
