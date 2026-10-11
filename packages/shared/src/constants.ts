/** Zona horaria por defecto de las sucursales (cada sucursal guarda la suya). */
export const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

export const CURRENCY = 'ARS';

/** Reglas de acceso de clientes (docs/fase-0/01-arquitectura.md §5). */
export const CUSTOMER_AUTH = {
  codeLength: 6,
  codeTtlMinutes: 10,
  maxAttempts: 5,
  maxCodesPerEmailPer15Min: 3,
  maxCodesPerEmailPerDay: 10,
  sessionDays: 30,
} as const;

export const STAFF_AUTH = {
  sessionDays: 7,
  maxFailedLogins: 5,
  lockMinutes: 15,
  invitationTtlHours: 72,
  passwordResetTtlMinutes: 30,
  secondFactorTtlMinutes: 10,
  passwordMinLength: 10,
} as const;

/** Versión del texto de consentimiento mostrado al cliente (se guarda en cada evento). */
export const CONSENT_POLICY_VERSION = '2026-09-v1';
