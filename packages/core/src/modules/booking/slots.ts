import { addDays, type Availability } from '@estoicos/shared';
import type { CoreDeps } from '../../deps';
import { mergeSlots } from './availability';
import { loadDays, type BranchRef, type EligibleBarber } from './booking-data';

/**
 * Horarios libres de varios días para uno o varios barberos (los que hacen los servicios).
 * `notBefore`/`notAfter`/`lastDate` limitan la reserva online; en el panel solo se excluye el pasado.
 */
export async function computeAvailability(
  deps: CoreDeps,
  input: {
    branch: BranchRef;
    barbers: EligibleBarber[];
    from: string;
    days: number;
    stepMinutes: number;
    notBefore: Date;
    notAfter?: Date | null;
    lastDate?: string | null;
    excludeAppointmentId?: string | undefined;
  },
): Promise<Availability> {
  const lastDate = input.lastDate ?? null;
  let to = addDays(input.from, input.days - 1);
  if (lastDate && to > lastDate) to = lastDate;
  if (!input.barbers.length || to < input.from) {
    return { timezone: input.branch.timezone, days: [], lastDate };
  }

  const days = await loadDays(deps.db, {
    branch: input.branch,
    barberIds: input.barbers.map((b) => b.id),
    from: input.from,
    to,
    excludeAppointmentId: input.excludeAppointmentId,
  });

  return {
    timezone: input.branch.timezone,
    lastDate,
    days: days.map((day) => ({
      date: day.date,
      slots: mergeSlots(
        {
          date: day.date,
          timezone: input.branch.timezone,
          stepMinutes: input.stepMinutes,
          closures: day.closures,
          notBefore: input.notBefore,
          notAfter: input.notAfter ?? null,
        },
        input.barbers.map((b) => {
          const data = day.barbers.get(b.id)!;
          return {
            barberId: b.id,
            intervals: data.intervals,
            busy: [...data.appointments, ...data.timeOffs],
            durationMin: b.durationMin,
          };
        }),
      ).map((s) => ({ time: s.time, startsAt: s.startsAt.toISOString(), barberIds: s.barberIds })),
    })),
  };
}
