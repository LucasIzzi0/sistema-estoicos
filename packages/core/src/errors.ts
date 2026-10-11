import { Prisma } from '@estoicos/db';

/**
 * Error de negocio. `message` está en español y la web lo muestra tal cual.
 * La API lo traduce a HTTP con `status` y `code`.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const Errors = {
  unauthenticated: () => new DomainError('UNAUTHENTICATED', 'Tenés que iniciar sesión.', 401),
  secondFactorRequired: () =>
    new DomainError('SECOND_FACTOR_REQUIRED', 'Ingresá el código que te enviamos por email.', 401),
  forbidden: (message = 'No tenés permiso para hacer esto.') => new DomainError('FORBIDDEN', message, 403),
  notFound: (message = 'No encontramos lo que buscabas.') => new DomainError('NOT_FOUND', message, 404),
  conflict: (message: string) => new DomainError('CONFLICT', message, 409),
  invalid: (message: string, details?: unknown) => new DomainError('INVALID', message, 422, details),
  invalidCredentials: () => new DomainError('INVALID_CREDENTIALS', 'Email o contraseña incorrectos.', 401),
  accountLocked: (minutes: number) =>
    new DomainError(
      'ACCOUNT_LOCKED',
      `Demasiados intentos fallidos. Probá de nuevo en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`,
      429,
    ),
  tooManyRequests: (message: string) => new DomainError('TOO_MANY_REQUESTS', message, 429),
  invalidCode: (message: string) => new DomainError('INVALID_CODE', message, 400),
  slotTaken: () =>
    new DomainError('SLOT_TAKEN', 'Ese horario ya no está disponible. Elegí otro, por favor.', 409),
  emailUnavailable: () =>
    new DomainError('EMAIL_UNAVAILABLE', 'No pudimos enviar el email. Probá de nuevo en un momento.', 503),
};

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Dos reservas del mismo horario: la restricción EXCLUDE de la base (23P01) o un deadlock
 * entre transacciones (40P01 / P2034). La API lo traduce a "ese horario ya no está disponible".
 */
export function isSlotConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  const cause = (error.meta as { driverAdapterError?: { cause?: { originalCode?: string } } } | undefined)
    ?.driverAdapterError?.cause;
  return cause?.originalCode === '23P01' || cause?.originalCode === '40P01';
}
