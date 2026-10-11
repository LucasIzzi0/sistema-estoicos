import { describe, expect, it } from 'vitest';
import {
  barberSlots,
  bookedMinutesWithin,
  mergeSlots,
  rankBarbersForAnyChoice,
  scheduleProblem,
  type BarberDay,
  type DayInput,
} from './availability';

const TZ = 'America/Argentina/Buenos_Aires';
// Martes 13/10/2026. Buenos Aires es UTC−3: 10:00 local = 13:00Z.
const DATE = '2026-10-13';
const at = (hhmm: string, date = DATE) => new Date(`${date}T${hhmm}:00-03:00`);
const times = (slots: { startsAt: Date }[]) =>
  slots.map((s) =>
    s.startsAt.toLocaleTimeString('es-AR', {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  );

const day = (over: Partial<DayInput> = {}): DayInput => ({
  date: DATE,
  timezone: TZ,
  stepMinutes: 15,
  closures: [],
  ...over,
});
const barber = (over: Partial<BarberDay> = {}): BarberDay => ({
  barberId: 'juan',
  intervals: [{ startMinute: 600, endMinute: 720 }], // 10:00–12:00
  busy: [],
  durationMin: 30,
  ...over,
});

describe('barberSlots', () => {
  it('ofrece inicios cada 15 minutos donde entra el servicio completo', () => {
    expect(times(barberSlots(day(), barber()))).toEqual([
      '10:00',
      '10:15',
      '10:30',
      '10:45',
      '11:00',
      '11:15',
      '11:30',
    ]);
  });

  it('el último turno termina justo al cierre del tramo (borde exacto)', () => {
    const slots = barberSlots(day(), barber({ durationMin: 60 }));
    expect(times(slots).at(-1)).toBe('11:00');
    expect(slots.at(-1)!.endsAt.toISOString()).toBe(at('12:00').toISOString());
  });

  it('un servicio más largo que el tramo no tiene horarios', () => {
    expect(barberSlots(day(), barber({ durationMin: 150 }))).toEqual([]);
  });

  it('convierte con la zona de la sucursal: 10:00 en Buenos Aires = 13:00 UTC', () => {
    expect(barberSlots(day(), barber())[0]!.startsAt.toISOString()).toBe('2026-10-13T13:00:00.000Z');
  });

  it('turno partido: respeta el hueco del almuerzo', () => {
    const slots = barberSlots(
      day(),
      barber({
        intervals: [
          { startMinute: 840, endMinute: 900 }, // 14:00–15:00 (desordenado a propósito)
          { startMinute: 600, endMinute: 660 }, // 10:00–11:00
        ],
        durationMin: 45,
      }),
    );
    expect(times(slots)).toEqual(['10:00', '10:15', '14:00', '14:15']);
  });

  it('un turno existente bloquea los inicios que lo pisarían (intervalo semiabierto)', () => {
    const slots = barberSlots(day(), barber({ busy: [{ startsAt: at('10:30'), endsAt: at('11:00') }] }));
    // 10:00 termina 10:30 justo cuando empieza el otro: vale. 10:15 lo pisa. 11:00 empieza al terminar.
    expect(times(slots)).toEqual(['10:00', '11:00', '11:15', '11:30']);
  });

  it('bloqueos de horas y cierres de la sucursal quitan horarios', () => {
    expect(
      times(barberSlots(day(), barber({ busy: [{ startsAt: at('10:00'), endsAt: at('11:30') }] }))),
    ).toEqual(['11:30']);
    const closed = day({ closures: [{ startsAt: at('00:00'), endsAt: at('00:00', '2026-10-14') }] });
    expect(barberSlots(closed, barber())).toEqual([]);
  });

  it('anticipación mínima y máxima', () => {
    const slots = barberSlots(day({ notBefore: at('10:40'), notAfter: at('11:15') }), barber());
    expect(times(slots)).toEqual(['10:45', '11:00', '11:15']);
  });

  it('respeta un paso distinto y tramos que no empiezan en punto', () => {
    const slots = barberSlots(
      day({ stepMinutes: 20 }),
      barber({ intervals: [{ startMinute: 610, endMinute: 700 }], durationMin: 40 }),
    );
    expect(times(slots)).toEqual(['10:10', '10:30', '10:50']);
  });

  it('sin tramos ese día no hay horarios', () => {
    expect(barberSlots(day(), barber({ intervals: [] }))).toEqual([]);
  });
});

describe('zona horaria con cambio de hora', () => {
  it('si hubiera horario de verano, los turnos siguen en hora local', () => {
    // Santiago de Chile adelanta el reloj el 6/9/2026 a las 00:00 (00:00 → 01:00).
    const slots = barberSlots(
      { date: '2026-09-06', timezone: 'America/Santiago', stepMinutes: 60, closures: [] },
      barber({ intervals: [{ startMinute: 600, endMinute: 720 }], durationMin: 60 }),
    );
    // 10:00 en Santiago con horario de verano (UTC−3) = 13:00Z.
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      '2026-09-06T13:00:00.000Z',
      '2026-09-06T14:00:00.000Z',
    ]);
  });
});

describe('mergeSlots ("cualquier barbero")', () => {
  it('une los horarios e indica quién está libre en cada uno', () => {
    const merged = mergeSlots(day({ stepMinutes: 30 }), [
      barber({ barberId: 'juan', busy: [{ startsAt: at('10:00'), endsAt: at('11:00') }] }),
      barber({ barberId: 'pedro', intervals: [{ startMinute: 630, endMinute: 720 }] }),
    ]);
    expect(merged.map((s) => [s.time, s.barberIds])).toEqual([
      ['10:30', ['pedro']],
      ['11:00', ['juan', 'pedro']],
      ['11:30', ['juan', 'pedro']],
    ]);
  });

  it('cada barbero usa su propia duración', () => {
    const merged = mergeSlots(day({ stepMinutes: 30 }), [
      barber({ barberId: 'lento', durationMin: 90 }),
      barber({ barberId: 'rapido', durationMin: 30 }),
    ]);
    expect(merged.find((s) => s.time === '11:00')!.barberIds).toEqual(['rapido']);
    expect(merged.find((s) => s.time === '10:30')!.barberIds).toEqual(['lento', 'rapido']);
  });
});

describe('scheduleProblem (turnos del staff)', () => {
  const intervals = [{ startMinute: 600, endMinute: 720 }];
  it('dentro del horario no hay problema', () => {
    expect(scheduleProblem(day(), intervals, [], { startsAt: at('10:00'), endsAt: at('12:00') })).toBeNull();
  });
  it('fuera del horario, bloqueo o feriado', () => {
    expect(scheduleProblem(day(), intervals, [], { startsAt: at('11:45'), endsAt: at('12:15') })).toBe(
      'OUTSIDE_SCHEDULE',
    );
    expect(
      scheduleProblem(day(), intervals, [{ startsAt: at('11:00'), endsAt: at('11:30') }], {
        startsAt: at('11:00'),
        endsAt: at('11:30'),
      }),
    ).toBe('TIME_OFF');
    expect(
      scheduleProblem(day({ closures: [{ startsAt: at('00:00'), endsAt: at('23:59') }] }), intervals, [], {
        startsAt: at('10:00'),
        endsAt: at('10:30'),
      }),
    ).toBe('CLOSURE');
  });
});

describe('reparto de "cualquier barbero"', () => {
  it('gana quien tiene menos minutos reservados; si empatan, el orden del admin', () => {
    expect(
      rankBarbersForAnyChoice([
        { barberId: 'a', bookedMinutes: 90, sortOrder: 0, name: 'A' },
        { barberId: 'b', bookedMinutes: 30, sortOrder: 2, name: 'B' },
        { barberId: 'c', bookedMinutes: 30, sortOrder: 1, name: 'C' },
      ]),
    ).toEqual(['c', 'b', 'a']);
  });

  it('cuenta solo los minutos dentro del día', () => {
    const window = { startsAt: at('00:00'), endsAt: at('00:00', '2026-10-14') };
    expect(
      bookedMinutesWithin(
        [
          { startsAt: at('10:00'), endsAt: at('10:45') },
          { startsAt: at('23:30'), endsAt: at('00:30', '2026-10-14') },
        ],
        window,
      ),
    ).toBe(75);
  });
});
