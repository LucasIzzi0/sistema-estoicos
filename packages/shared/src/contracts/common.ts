import { z } from 'zod';
import { STAFF_AUTH } from '../constants';
import { normalizeMobilePhone } from '../phone';

/** Email normalizado (sin espacios, en minúsculas). */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: 'Ingresá un email válido' }));

export const passwordSchema = z
  .string()
  .min(STAFF_AUTH.passwordMinLength, {
    error: `La contraseña debe tener al menos ${STAFF_AUTH.passwordMinLength} caracteres`,
  })
  .max(128, { error: 'La contraseña es demasiado larga' });

/** Celular argentino normalizado a E.164 (+549…), como lo necesita WhatsApp. */
export const mobilePhoneSchema = z
  .string()
  .trim()
  .min(6, { error: 'Ingresá un celular válido' })
  .transform((value, ctx) => {
    const normalized = normalizeMobilePhone(value);
    if (!normalized) {
      ctx.issues.push({
        code: 'custom',
        message: 'Ingresá un celular válido, por ejemplo 11 2233-4455',
        input: value,
      });
      return z.NEVER;
    }
    return normalized;
  });

export const personNameSchema = z.string().trim().min(1, { error: 'Completá este campo' }).max(80);

export const uuidSchema = z.uuid();

/** Forma única de los errores de la API. `message` está en español y se puede mostrar tal cual. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const okSchema = z.object({ ok: z.literal(true) });

/** Monto en centavos (entero, sin decimales). $15.000 = 1500000. */
export const centsSchema = z
  .number({ error: 'Ingresá un monto' })
  .int({ error: 'El monto va en centavos, sin decimales' })
  .min(0, { error: 'El monto no puede ser negativo' })
  .max(Number.MAX_SAFE_INTEGER);

/** Porcentaje en puntos básicos: 10000 = 100 %. */
export const bpsSchema = z
  .number()
  .int()
  .min(0, { error: 'El porcentaje no puede ser negativo' })
  .max(10_000, { error: 'El porcentaje no puede superar el 100 %' });

/** Fecha de calendario "AAAA-MM-DD" (hora local de la sucursal). */
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Fecha inválida' });

/** Hora "HH:MM" (hora local de la sucursal). */
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Hora inválida' });

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** Una sucursal por id en la URL. */
export const branchIdParams = z.object({ branchId: z.uuid() });
